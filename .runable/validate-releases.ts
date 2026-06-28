import { releaseJournalSchema } from "./releases.schema";
import { z } from "zod/v4";

const journal = await Bun.file(new URL("./releases.json", import.meta.url)).json();
const result = releaseJournalSchema.safeParse(journal);

if (!result.success) {
  console.error(z.prettifyError(result.error));
  process.exit(1);
}

console.log(`Validated ${result.data.releases.length} managed app release(s)`);
