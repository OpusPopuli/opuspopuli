import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ILLMProvider } from "@opuspopuli/common";
import { llmConfig } from "@opuspopuli/config-provider";
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
 * - qwen3.5:9b (default dev, 9B, 256K context, Apache 2.0)
 * - qwen3.5:35b (default prod, 35B, 256K context, Apache 2.0)
 * - mistral (7B, instruction following and JSON output)
 * - Or any other model from ollama.com/library
 *
 * Setup:
 * 1. Install Ollama: https://ollama.com
 * 2. Pull model: ollama pull qwen3.5:9b
 * 3. Start server: ollama serve
 */
@Module({
  imports: [ConfigModule.forFeature(llmConfig)],
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
