import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

const schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    // Keep preview links aligned with the opener allowlist; drop http/irc/xmpp/etc.
    href: ['https', 'mailto'],
    // Block remote image beacons. Empty allow-lists are treated as unrestricted
    // by rehype-sanitize, so keep only data: (relative src still works).
    src: ['data'],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize, schema)
  .use(rehypeStringify);

export async function renderMarkdown(markdown: string): Promise<string> {
  return String(await processor.process(markdown));
}
