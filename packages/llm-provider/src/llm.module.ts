import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ILLMProvider } from "@opuspopuli/common";
import {
  OllamaLLMProvider,
  OllamaConfig,
} from "./providers/ollama.provider.js";

/**
 * LLM Module
 *
 * Configures Dependency Injection for language model providers.
 *
 * Provider: Ollama (self-hosted, OSS, full privacy)
 *
 * Supports any Ollama model:
 * - mistral (default, 7B, excellent instruction following and JSON output)
 * - llama3.2 (3B, fast and efficient)
 * - llama3.1 (8B, long context)
 * - falcon (7B, TII's open-source model)
 * - Or any other model from ollama.ai/library
 *
 * Setup:
 * 1. Install Ollama: https://ollama.ai
 * 2. Pull model: ollama pull mistral
 * 3. Start server: ollama serve
 */
@Module({
  providers: [
    // LLM provider selection
    {
      provide: "LLM_PROVIDER",
      useFactory: (configService: ConfigService): ILLMProvider => {
        // OSS: Self-hosted inference with Ollama
        const ollamaConfig: OllamaConfig = {
          url:
            configService.get<string>("llm.ollama.url") ||
            configService.get<string>("llm.url") ||
            "http://localhost:11434",
          model:
            configService.get<string>("llm.ollama.model") ||
            configService.get<string>("llm.model") ||
            "mistral",
        };

        return new OllamaLLMProvider(ollamaConfig);
      },
      inject: [ConfigService],
    },
  ],
  exports: ["LLM_PROVIDER"],
})
export class LLMModule {}
