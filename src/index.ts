import { runPipeline } from "./pipeline.js";

runPipeline((event) => {
  console.log(`[${event.agent}] ${event.status}${event.message ? " — " + event.message : ""}`);
}).then((result) => {
  if (result) {
    console.log(`Post publicado: /blog/${result.slugPublicado}`);
  }
}).catch((err) => {
  console.error("Falha no pipeline:", err);
  process.exit(1);
});
