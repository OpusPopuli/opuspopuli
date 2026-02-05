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
 * - falcon (default, 7B, TII's open-source model)
 * - llama3.2 (3B, fast and efficient)
 * - mistral (7B, excellent quality)
 * - llama3.1 (8B, latest Llama)
 * - Or any other model from ollama.ai/library
 *
 * Setup:
 * 1. Install Ollama: https://ollama.ai
 * 2. Pull model: ollama pull falcon
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
            "falcon",
        };

        return new OllamaLLMProvider(ollamaConfig);
      },
      inject: [ConfigService],
    },
  ],
  exports: ["LLM_PROVIDER"],
})
export class LLMModule {}
