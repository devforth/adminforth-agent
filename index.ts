import { AdminForthPlugin } from "adminforth";
import type { IAdminForth, IHttpServer, AdminForthResource } from "adminforth";
import type { PluginOptions } from './types.js';
import { randomUUID } from 'crypto';
import { Filters, Sorts } from 'adminforth';
import { compose } from "stream";

const STUB_MODE=false;
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
$$\\sigma = \\sqrt{\\frac{1}{N} \\sum_{i=1}^{N} (x_i - \\mu)^2}$$

**Inline variables:** Ensure the variable $x$ is defined before the function is called.

---

## 5. Resources
* [Markdown Guide](https://www.markdownguide.org)
* [LaTeX Reference](https://en.wikibooks.org/wiki/LaTeX/Mathematics)
* [GitHub Markdown Documentation](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax)

## 6. Ukraine Population Trend (1991 - 2023)

The graph below visualizes the estimated population change in Ukraine since its independence. This chart uses the xychart-beta format to display the population in millions over key selected years.

> **Note:** The data points below are approximations (based on World Bank, State Statistics Service of Ukraine, and UN estimates) intended to illustrate the general *trend* and significant shifts.

~~~mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#0057B7', 'edgeLabelBackground':'#FFD700', 'tertiaryColor': '#fff'}}}%%
xychart-beta
    title "Ukraine Estimated Population (1991 - 2023)"
    x-axis [1991, 1995, 2000, 2005, 2010, 2013, 2014, 2021, 2022, 2023]
    y-axis "Population (Millions)" 25 --> 55
    bar [51.9, 51.3, 49.2, 47.1, 45.9, 45.4, 42.9, 41.1, 38.0, 37.0]
    line [51.9, 51.3, 49.2, 47.1, 45.9, 45.4, 42.9, 41.1, 38.0, 37.0]
~~~

## 7. Configuration Example

This section provides a standard JSON configuration template often used for API setups or application settings.

~~~json
{
  "project_name": "Population_Analysis",
  "version": "1.0.0",
  "settings": {
    "data_source": "official_statistics",
    "update_frequency": "yearly",
    "enable_visualization": true,
    "theme": {
      "primary_color": "#0057B7",
      "secondary_color": "#FFD700"
    }
  },
  "endpoints": [
    {
      "name": "population_data",
      "url": "/api/v1/population",
      "method": "GET"
    }
  ]
}
~~~

## 8. JavaScript Implementation

This block demonstrates a simple function to calculate the percentage change in population, which can be used to process data arrays like the ones in the previous section.

~~~javascript
/**
 * Calculates the percentage change between two population values.
 * @param {number} initial - The starting population.
 * @param {number} final - The ending population.
 * @returns {string} - Formatted percentage change.
 */
function calculatePopulationChange(initial, final) {
    if (initial === 0) return "0%";
    
    const change = ((final - initial) / initial) * 100;
  return \`\${change.toFixed(2)}%\`;
}

// Example usage with data points from 1991 to 2023
const pop1991 = 51.9;
const pop2023 = 37.0;

const result = calculatePopulationChange(pop1991, pop2023);
console.log(\`The total population change from 1991 to 2023 is: \${result}\`);
~~~


## 9. Python Data Analysis Implementation

This block demonstrates how to use the pandas library to calculate the annual growth rate (or decline) based on the population data provided earlier.

~~~python
import pandas as pd

# Data: Population in millions for selected years
data = {
    'Year': [1991, 1995, 2000, 2005, 2010, 2013, 2014, 2021, 2022, 2023],
    'Population': [51.9, 51.3, 49.2, 47.1, 45.9, 45.4, 42.9, 41.1, 38.0, 37.0]
}

df = pd.DataFrame(data)

# Calculate the difference between consecutive years
df['Change_Millions'] = df['Population'].diff()

# Calculate percentage change
df['Pct_Change'] = df['Population'].pct_change() * 100

print("Population Trends Analysis:")
print(df[['Year', 'Population', 'Pct_Change']])

# Example: Get the average annual percentage change
avg_decline = df['Pct_Change'].mean()
print(f"\nAverage annual percentage change: {avg_decline:.2f}%")

~~~
`;

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

    if (!this.pluginOptions.completionAdapter) {
      throw new Error("CompletionAdapter is required for AdminForthAgentPlugin");
    }
    if (!this.pluginOptions.sessionResource) {
      throw new Error("sessionResource is required for AdminForthAgentPlugin");
    }
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
        const prompt = body.message;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'x-vercel-ai-ui-message-stream': 'v1',
        });

        const send = (obj) => {
          res.write(`data: ${JSON.stringify(obj)}\n\n`);
        };

        let activeBlock: { type: 'text' | 'reasoning'; id: string } | null = null;

        const endActiveBlock = () => {
          if (!activeBlock) {
            return;
          }

          send({
            type: `${activeBlock.type}-end`,
            id: activeBlock.id,
          });

          activeBlock = null;
        };

        const startBlock = (type: 'text' | 'reasoning') => {
          if (activeBlock?.type === type) {
            return activeBlock.id;
          }

          endActiveBlock();

          const id = randomUUID();
          activeBlock = { type, id };

          send({
            type: `${type}-start`,
            id,
          });

          return id;
        };

        const endStream = () => {
          endActiveBlock();

          send({
            type: 'finish',
          });

          res.write(`data: [DONE]\n\n`);
        }

        send({
          type: 'start',
          messageId,
        });
        if (!STUB_MODE) {
          const response = await this.options.completionAdapter.complete(
            prompt, 
            this.options.maxTokens || 1000, 
            undefined, 
            this.options.reasoning || "low", 
            (chunk, event) => {
              if (event.type === 'reasoning') {
                const reasoningId = startBlock('reasoning');
                send({
                  type: 'reasoning-delta',
                  id: reasoningId,
                  delta: chunk,
                });
              } else {
                const textId = startBlock('text');
                send({
                  type: 'text-delta',
                  id: textId,
                  delta: chunk,
                });
              }
            }
          );
          if (response.error) {
            console.error('Error from adapter:', response.error);
          }
          endStream();
        } else {
          const words = text.split(' ');
          let index = 0;
          await new Promise((resolve) => {
            const interval = setInterval(() => {
              if (index < words.length) {
                const textId = startBlock('text');
                send({
                  type: 'text-delta',
                  id: textId,
                  delta: words[index] + ' ',
                });

                index++;
              } else {
                clearInterval(interval);
                endStream();
                resolve(null);
              }
            }, 10);
          });
        }
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/get-sessions`,
      handler: async ({body, adminUser }) => {
        const userId = adminUser.pk;
        const sessions = await this.adminforth.resource(this.pluginOptions.sessionResource.resource_id).list(
          [Filters.EQ(this.pluginOptions.sessionResource.asker_id_field, userId)]
        );
        const sessionsToReturn = [];
        for (const session of sessions) {
         sessionsToReturn.push({
          sessionId: session[this.pluginOptions.sessionResource.id_field],
          title: session[this.pluginOptions.sessionResource.title_field],
          timestamp: session[this.pluginOptions.sessionResource.created_at_field],
         })
        }
        return {
          sessions: sessionsToReturn
        };
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/get-session-info`,
      handler: async ({body, adminUser }) => {
        const userId = adminUser.pk;
        const sessionId = body.sessionId;
        const session = await this.adminforth.resource(this.pluginOptions.sessionResource.resource_id).get(
          [Filters.EQ(this.pluginOptions.sessionResource.id_field, sessionId)]
        );
        if (!session) {
          return {
            error: 'Session not found'
          };
        }
        if (session[this.pluginOptions.sessionResource.asker_id_field] !== userId) {
          return {
            error: 'Unauthorized'
          };
        }
        const sessionToReturn = {
          sessionId: session[this.pluginOptions.sessionResource.id_field],
          title: session[this.pluginOptions.sessionResource.title_field],
          timestamp: session[this.pluginOptions.sessionResource.created_at_field],
          messages: []
        }
        return {
          session: sessionToReturn
        }
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/create-session`,
      handler: async ({body, adminUser }) => {
        const triggerMessage = body.triggerMessage;
        const userId = adminUser.pk;
        const title = triggerMessage ? triggerMessage.slice(0, 50) : 'New Session';
        const newSession = {
          [this.pluginOptions.sessionResource.id_field]: randomUUID(),
          [this.pluginOptions.sessionResource.title_field]: title,
          [this.pluginOptions.sessionResource.asker_id_field]: userId,
        };
        await this.adminforth.resource(this.pluginOptions.sessionResource.resource_id).create(newSession);
        return {
          sessionId: newSession[this.pluginOptions.sessionResource.id_field],
          title: newSession[this.pluginOptions.sessionResource.title_field],
          timestamp: newSession[this.pluginOptions.sessionResource.created_at_field],
          messages: []
        };
      }
    });
    server.endpoint({
      method: 'POST',
      path: `/agent/delete-session`,
      handler: async ({body, adminUser }) => {
        const sessionId = body.sessionId;
        const userId = adminUser.pk;
        const session = await this.adminforth.resource(this.pluginOptions.sessionResource.resource_id).get(
          [Filters.EQ(this.pluginOptions.sessionResource.id_field, sessionId)]
        );
        if (!session) {
          return {
            error: 'Session not found'
          };
        }
        if (session[this.pluginOptions.sessionResource.asker_id_field] !== userId) {
          return {
            error: 'Unauthorized'
          };
        }
        await this.adminforth.resource(this.pluginOptions.sessionResource.resource_id).delete(
          [Filters.EQ(this.pluginOptions.sessionResource.id_field, sessionId)]
        );
        return {
          ok: true
        };
      }
    });
  }

}