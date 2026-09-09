import { main } from "./dispatch";

export { main } from "./dispatch";

// `dist/index.js` is the published `bin`, and CI and the docs invoke it directly, so the entry
// point stays here. The dispatch itself lives in ./dispatch so tests can import it without this
// module's side effect running the CLI against the test runner's own argv.
main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    process.stderr.write(`Error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
