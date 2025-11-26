/**
 * Verbose logging utilities for the agent pipeline.
 * Used when --verbose flag is passed to CLI.
 */

export function logStep(stepNumber: number, stepType: string) {
  console.log(`\n📍 Step ${stepNumber}: ${stepType}`);
}

export function logToolCall(toolName: string, params: unknown, result: unknown) {
  console.log(`\n🔧 Tool: ${toolName}`);
  const inputLines = JSON.stringify(params, null, 2).split('\n');
  console.log(`   Input: ${inputLines.join('\n   ')}`);
  const resultLines = JSON.stringify(result, null, 2).split('\n');
  console.log(`   Result: ${resultLines.join('\n   ')}`);
}

export function logAgentText(text: string) {
  console.log(`\n💬 Agent: ${text}`);
}

export function logFileContent(path: string, content: string, maxLines = 50) {
  console.log(`\n📄 File: ${path}`);
  const lines = content.split('\n');
  const preview = lines.slice(0, maxLines).join('\n');
  console.log('─'.repeat(60));
  console.log(preview);
  if (lines.length > maxLines) {
    console.log(`... (${lines.length - maxLines} more lines)`);
  }
  console.log('─'.repeat(60));
}
