import ballerinax/ai.anthropic;

// The model is reached through the WSO2 AI Gateway's Anthropic-compatible LLM proxy
// (boa-llm-v1), never Anthropic directly. The provider sends the key in `x-api-key`, the
// header the proxy's api-key-auth policy checks; the gateway then swaps in its own upstream
// Anthropic key. The provider posts to `<serviceUrl>/messages`, hence the `/v1` suffix.
final anthropic:ANTHROPIC_MODEL_NAMES gatewayModel = check llmModel.ensureType();

final anthropic:ModelProvider taxAgentModel = check new (apiKey = gatewayApiKey, modelType = gatewayModel,
    serviceUrl = string `${gatewayBaseUrl}/v1`);
