import { AdminForthPlugin } from "adminforth";
import type { IAdminForth, IHttpServer, AdminForthResourcePages, AdminForthResourceColumn, AdminForthDataTypes, AdminForthResource } from "adminforth";
import type { PluginOptions } from './types.js';
import { randomUUID } from 'crypto';


export default class  extends AdminForthPlugin {
  options: PluginOptions;

  constructor(options: PluginOptions) {
    super(options, import.meta.url);
    this.options = options;
    this.shouldHaveSingleInstancePerWholeApp = () => false;
  }

  async modifyResourceConfig(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    super.modifyResourceConfig(adminforth, resourceConfig);
    if (!this.adminforth.config.customization.globalInjections.header) {
      this.adminforth.config.customization.globalInjections.header = [];
    }
    this.adminforth.config.customization.globalInjections.header.push({
      file: this.componentPath("ChatSurface.vue"),
      meta: {
        pluginInstanceId: this.pluginInstanceId,
      }
    });
  }
  
  validateConfigAfterDiscover(adminforth: IAdminForth, resourceConfig: AdminForthResource) {
    // optional method where you can safely check field types after database discovery was performed
  }

  instanceUniqueRepresentation(pluginOptions: any) : string {
    return `single`;
  }

  setupEndpoints(server: IHttpServer) {
    server.endpoint({
      method: 'POST',
      path: `/agent/response`,
      handler: async ({body, _raw_express_res }) => {
        const res = _raw_express_res;

        const messageId = randomUUID();
        const textId = randomUUID();

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'x-vercel-ai-ui-message-stream': 'v1',
        });

        const send = (obj) => {
          console.log('Sending chunk:', obj);
          res.write(`data: ${JSON.stringify(obj)}\n\n`);
        };

        send({
          type: 'start',
          messageId,
        });

        send({
          type: 'text-start',
          id: textId,
        });

        const text = `# Project Title: Markdown Template
---

## 1. Introduction
This is a standard paragraph. Use this space to describe the purpose of your document. You can use **bold text** for emphasis or *italics* for subtle highlights.

> **Pro-Tip:** Use blockquotes to call out specific warnings or important notes.

---

## 2. Features & Requirements
### Key Features
* **Adaptive:** Works in most editors.
* **Lightweight:** No heavy file size.
* **Portable:** Easy to convert to PDF or HTML.

### Task List
- [x] Define project scope
- [x] Design layout
- [ ] Finalize documentation
- [ ] Export to production

---

## 3. Technical Specifications

### Data Table
| ID | Parameter | Value | Status |
| :--- | :--- | :--- | :--- |
| 001 | Latency | < 20ms | Green |
| 002 | Throughput | 500 gb/s | Yellow |
| 003 | Error Rate | 0.01% | Green |
## 4. Mathematics & Formulas
When working with scientific data, use LaTeX for clarity:

**Standard Deviation:**
$$\sigma = \sqrt{\frac{1}{N} \sum_{i=1}^{N} (x_i - \mu)^2}$$

**Inline variables:** Ensure the variable $x$ is defined before the function is called.

---

## 5. Resources
* [Markdown Guide](https://www.markdownguide.org)
* [LaTeX Reference](https://en.wikibooks.org/wiki/LaTeX/Mathematics)
* [GitHub Markdown Documentation](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)
`
        const words = text.split(' ');

        let index = 0;

        await new Promise((resolve) => {
          const interval = setInterval(() => {
            if (index < words.length) {
              send({
                type: 'text-delta',
                id: textId,
                delta: words[index] + ' ',
              });

              index++;
            } else {
              clearInterval(interval);

              send({
                type: 'text-end',
                id: textId,
              });

              send({
                type: 'finish',
              });

              res.write(`data: [DONE]\n\n`);
              console.log('Stream finished, closing connection.');
              resolve(null);
            }
          }, 60);
        });
      }
    });
  }

}