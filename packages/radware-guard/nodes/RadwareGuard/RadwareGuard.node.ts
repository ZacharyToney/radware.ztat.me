import {
	NodeConnectionTypes,
	NodeOperationError,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';

import { evaluate, type FailMode, type GuardPayload, type Transport } from './guard';

const DEFAULT_BASE_URL = 'https://api.agentic.radwarecto.com';
const DEFAULT_ENDPOINT_PATH = '/llmp/digester/agentic-api';
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Not exposed as an AI Agent tool, deliberately.
 *
 * `usableAsTool` accepts only `true`, so the property is omitted rather than
 * set to false. The guard must never be callable by the model it is guarding:
 * an agent that can invoke its own enforcement point can be steered into
 * calling it with sanitised arguments, reading the verdict, and then acting
 * anyway. The guard belongs on the deterministic path ahead of the action,
 * where the workflow controls it and the model cannot.
 */
// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool -- see the note above
export class RadwareGuard implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Radware Guard',
		name: 'radwareGuard',
		icon: { light: 'file:../../icons/guard.svg', dark: 'file:../../icons/guard.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["toolName"]}}',
		description:
			'Ask Radware Agentic AI Protection whether a tool call may proceed, before it executes',
		defaults: { name: 'Radware Guard' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.Main],
		outputNames: ['Allowed', 'Blocked'],
		credentials: [{ name: 'radwareOutOfPathApi', required: true }],
		properties: [
			{
				displayName:
					'Place this node at the start of a tool sub-workflow, ahead of the action it guards. It decides for one tool call; it does not intercept the agent globally.',
				name: 'placementNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Tool Name',
				name: 'toolName',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'send_email',
				description: 'Name of the tool that is about to run. Radware evaluates the action by name.',
			},
			{
				displayName: 'Tool Arguments',
				name: 'argsInput',
				type: 'json',
				default: '{}',
				description: 'Arguments the agent wants to pass to the tool',
			},
			{
				displayName: 'User Prompt',
				name: 'userPrompt',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				description: 'The end user request that led to this tool call',
			},
			{
				displayName: 'User Identifier',
				name: 'userIdentifier',
				type: 'string',
				default: '',
				description: 'Identifier for the user on whose behalf the agent is acting',
			},
			{
				displayName: 'User Context',
				name: 'userContext',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description:
					'Conversation history plus any retrieved content. Include untrusted tool output here: it is the material an indirect prompt injection would arrive in, and Radware cannot weigh what it is not shown.',
			},
			{
				displayName: 'Advertised Tools',
				name: 'toolsInput',
				type: 'json',
				default: '[]',
				description:
					'Full tool list available to the agent, in OpenAI function format. Behavioral detection needs the whole set, not only the tool being guarded.',
			},
			{
				displayName: 'Model',
				name: 'modelToUse',
				type: 'string',
				default: 'gpt-4o',
				description: 'Model the agent is running, passed through for event attribution',
			},
			{
				displayName: 'Fail Mode',
				name: 'failMode',
				type: 'options',
				default: 'failClose',
				options: [
					{
						name: 'Fail Closed',
						value: 'failClose',
						description: 'Block the tool if Radware does not return a decision',
					},
					{
						name: 'Fail Open',
						value: 'failOpen',
						description: 'Allow the tool if Radware does not return a decision',
					},
				],
				description:
					'What to do when the protection service is unreachable, times out, or answers unusably. Set per tool: a read is a reasonable fail-open, an outbound send is not.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const allowed: INodeExecutionData[] = [];
		const blocked: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('radwareOutOfPathApi');
		const apiKey = String(credentials.apiKey ?? '');
		const baseUrl = String(credentials.baseUrl || DEFAULT_BASE_URL);
		const endpointPath = String(credentials.endpointPath || DEFAULT_ENDPOINT_PATH);
		const timeoutMs = Number(credentials.timeoutMs) || DEFAULT_TIMEOUT_MS;

		const transport: Transport = async (url, payload, timeout) => {
			const response = (await this.helpers.httpRequest({
				method: 'POST',
				url,
				body: payload,
				json: true,
				timeout,
				returnFullResponse: true,
				ignoreHttpStatusErrors: true,
			})) as { statusCode: number; body: unknown };

			return { statusCode: response.statusCode, body: response.body };
		};

		for (let i = 0; i < items.length; i++) {
			const toolName = this.getNodeParameter('toolName', i) as string;
			const failMode = this.getNodeParameter('failMode', i) as FailMode;

			const payload: GuardPayload = {
				UserPrompt: this.getNodeParameter('userPrompt', i, '') as string,
				UserIdentifier: this.getNodeParameter('userIdentifier', i, '') as string,
				UserContext: this.getNodeParameter('userContext', i, '') as string,
				ToolName: toolName,
				ApiKey: apiKey,
				ArgsInput: parseJsonParameter(this, 'argsInput', i, {}),
				ToolsInput: parseJsonParameter(this, 'toolsInput', i, []),
				ModelToUse: this.getNodeParameter('modelToUse', i, 'gpt-4o') as string,
			};

			const decision = await evaluate(
				payload,
				{ baseUrl, endpointPath, timeoutMs, failMode },
				transport,
			);

			const entry: INodeExecutionData = {
				json: {
					...items[i].json,
					radware: {
						toolName,
						isBlocked: decision.isBlocked,
						eventId: decision.eventId,
						decidedBy: decision.decidedBy,
						...(decision.reason === undefined ? {} : { reason: decision.reason }),
					},
				},
				pairedItem: { item: i },
			};

			if (decision.isBlocked) blocked.push(entry);
			else allowed.push(entry);
		}

		return [allowed, blocked];
	}
}

/**
 * `json` parameters arrive either already parsed or as a string, depending on
 * whether the user typed a literal or wrote an expression. Normalise both, and
 * fail loudly with the offending item index rather than quietly guarding a call
 * with empty arguments, which would look like a pass.
 */
function parseJsonParameter(
	ctx: IExecuteFunctions,
	parameterName: string,
	itemIndex: number,
	fallback: unknown,
): unknown {
	const raw = ctx.getNodeParameter(parameterName, itemIndex, fallback);

	if (typeof raw !== 'string') return raw;
	if (raw.trim() === '') return fallback;

	try {
		return JSON.parse(raw);
	} catch {
		throw new NodeOperationError(
			ctx.getNode(),
			`Parameter "${parameterName}" is not valid JSON`,
			{ itemIndex },
		);
	}
}
