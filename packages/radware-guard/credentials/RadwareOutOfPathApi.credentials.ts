import type {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

/**
 * Credential for Radware Agentic AI Protection out-of-path (explicit API call)
 * enforcement, as documented in the Radware Agentic AI Protection User Guide
 * 26.03.1, "If Using Out-of-Path Enforcement (Explicit API Call)".
 *
 * Note on auth shape: unlike the in-path endpoint, which takes a bearer token,
 * the out-of-path digester API expects the key inside the JSON body as `ApiKey`.
 * There is therefore no `authenticate()` here; the node reads the credential and
 * injects the key into the request body itself. The key is never exposed as a
 * node parameter and never appears in node output.
 */
export class RadwareOutOfPathApi implements ICredentialType {
	name = 'radwareOutOfPathApi';

	displayName = 'Radware Out-of-Path API';

	documentationUrl =
		'https://github.com/ZacharyToney/radware.ztat.me/blob/main/docs/out-of-path.md';

	icon: Icon = { light: 'file:../icons/guard.svg', dark: 'file:../icons/guard.dark.svg' };

	properties: INodeProperties[] = [
		{
			displayName: 'Radware API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'API key from a Radware homegrown agent created with Out-of-Path Enforcement in https://console.radwarecloud.com/. This is a different agent from the in-path one; an in-path key is not guaranteed to authorise the digester endpoint.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.agentic.radwarecto.com',
			description: 'Radware Agentic AI Protection API host. Override only for a private tenant.',
		},
		{
			displayName: 'Endpoint Path',
			name: 'endpointPath',
			type: 'string',
			default: '/llmp/digester/agentic-api',
			description: 'Path of the out-of-path agentic protection endpoint',
		},
		{
			displayName: 'Timeout (Ms)',
			name: 'timeoutMs',
			type: 'number',
			default: 5000,
			typeOptions: { minValue: 250, maxValue: 60000 },
			description:
				'How long to wait for a protection decision before applying the node’s configured fail mode',
		},
	];

	/**
	 * The credential test issues one benign, real request to the digester API.
	 * It is a genuine round trip, so it may produce a low-severity entry in the
	 * Radware portal Logs view. That is intentional: a test that does not reach
	 * the service does not prove the credential works.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '={{$credentials.endpointPath}}',
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: {
				UserPrompt: 'n8n credential connectivity check',
				UserIdentifier: 'n8n-credential-test',
				UserContext: '',
				ToolName: '',
				ApiKey: '={{$credentials.apiKey}}',
				ArgsInput: {},
				ToolsInput: [],
				ModelToUse: 'gpt-4o',
			},
		},
	};
}
