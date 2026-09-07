import { loadWorkspace } from "./workspace.js";
import { EnvSecretProvider } from "./lib/secrets.js";
import { buildWorkspaceContext } from "./context.js";
import { runInstagramPipeline } from "./instagramPipeline.js";

const workspaceId = process.env.WORKSPACE_ID ?? "nextassist";

const workspace = await loadWorkspace(workspaceId);
const ctx = await buildWorkspaceContext(workspace, new EnvSecretProvider());

const result = await runInstagramPipeline(ctx, (event) => {
  console.log(`[${workspaceId}][${event.agent}] ${event.status}${event.message ? " — " + event.message : ""}`);
});

if (!result.ok) {
  console.log(result.detalhes);
  process.exit(0);
}

console.log(result.permalink ? `Instagram publicado: ${result.permalink}` : result.detalhes);
