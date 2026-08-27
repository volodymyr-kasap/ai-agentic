import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
    name: "weather-service",
    version: "1.0.0",
});

server.tool(
    "get_weather",
    "Return the current weather",
    { city: z.string() },
    async ({ city }) => {
        const fakeData = {
            "Wrocław": "+22°C, sunny",
            "Berlin": "+18°C, windy",
        };
        return {
            content: [
                { type: "text", text: fakeData[city] ?? "No data" },
            ],
        };
    }
);

server.tool(
    "list_known_cities",
    "The list of cities",
    {},
    async () => ({
        content: [{ type: "text", text: JSON.stringify(["Wrocław", "Berlin"]) }],
    })
);

const transport = new StdioServerTransport();
await server.connect(transport);