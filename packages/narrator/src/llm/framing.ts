// Human framing law (spec, plan Global Constraints): no viewer-facing narrator
// string may reference AI/tools/prompts/models. Asserted at render + gate.
export const FORBIDDEN_FRAMING =
  /\b(AI|A\.I\.|artificial intelligence|language model|LLM|neural|prompt|context window|token|chatbot|simulation|model)\b/i
