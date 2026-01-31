# @qckstrt/ocr-provider

OCR (Optical Character Recognition) provider package for the qckstrt platform. Provides text extraction from images using Tesseract.js.

## Features

- **Tesseract.js Integration**: Fully in-process OCR - no external services required
- **Strategy Pattern**: Pluggable provider architecture for future OCR backends
- **NestJS Integration**: Ready-to-use module with dependency injection
- **Multiple Formats**: Supports PNG, JPEG, WebP, BMP, GIF, TIFF
- **Multi-language**: Configurable language support (100+ languages available)

## Installation

```bash
pnpm add @qckstrt/ocr-provider
```

## Usage

### Module Import

```typescript
import { Module } from '@nestjs/common';
import { OcrModule } from '@qckstrt/ocr-provider';

@Module({
  imports: [OcrModule],
})
export class AppModule {}
```

### Service Injection

```typescript
import { Injectable } from '@nestjs/common';
import { OcrService } from '@qckstrt/ocr-provider';

@Injectable()
export class DocumentService {
  constructor(private readonly ocrService: OcrService) {}

  async extractText(buffer: Buffer, mimeType: string) {
    const result = await this.ocrService.extractFromBuffer(buffer, mimeType);
    return {
      text: result.text,
      confidence: result.confidence,
      provider: result.provider,
    };
  }
}
```

### Direct Provider Usage

```typescript
import { TesseractOcrProvider } from '@qckstrt/ocr-provider';

const provider = new TesseractOcrProvider(['eng', 'spa']);

const result = await provider.extractText({
  type: 'buffer',
  buffer: imageBuffer,
  mimeType: 'image/png',
});

console.log(result.text);       // Extracted text
console.log(result.confidence); // Confidence percentage (0-100)
console.log(result.blocks);     // Word-level results with bounding boxes

// Clean up when done
await provider.terminate();
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OCR_PROVIDER` | OCR provider to use | `tesseract` |
| `OCR_LANGUAGES` | Comma-separated language codes | `eng` |

### Config File

```typescript
// config/ocr.config.ts
export default () => ({
  ocr: {
    provider: process.env.OCR_PROVIDER || 'tesseract',
    languages: process.env.OCR_LANGUAGES || 'eng',
  },
});
```

## API Reference

### OcrService

The main service that wraps the OCR provider.

#### Methods

| Method | Description |
|--------|-------------|
| `extractText(input: OcrInput)` | Extract text from OcrInput |
| `extractFromBuffer(buffer, mimeType)` | Extract from Buffer |
| `extractFromBase64(data, mimeType)` | Extract from base64 string |
| `supportsMimeType(mimeType)` | Check if MIME type is supported |
| `getProviderInfo()` | Get provider name and languages |

### OcrResult

```typescript
interface OcrResult {
  text: string;                // Full extracted text
  blocks: OcrTextBlock[];      // Word-level results
  confidence: number;          // Overall confidence (0-100)
  provider: string;            // Provider name
  processingTimeMs: number;    // Processing time
}

interface OcrTextBlock {
  text: string;
  confidence: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}
```

## Supported MIME Types

- `image/png`
- `image/jpeg` / `image/jpg`
- `image/webp`
- `image/bmp`
- `image/gif`
- `image/tiff`

## Language Codes

Common language codes (ISO 639-3):

| Code | Language |
|------|----------|
| `eng` | English |
| `spa` | Spanish |
| `fra` | French |
| `deu` | German |
| `ita` | Italian |
| `por` | Portuguese |
| `chi_sim` | Chinese (Simplified) |
| `jpn` | Japanese |
| `kor` | Korean |

See [Tesseract Languages](https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html) for the complete list.

## Error Handling

```typescript
import { OcrError, UnsupportedMimeTypeError } from '@qckstrt/common';

try {
  const result = await ocrService.extractFromBuffer(buffer, mimeType);
} catch (error) {
  if (error instanceof UnsupportedMimeTypeError) {
    console.error(`MIME type ${mimeType} not supported`);
  } else if (error instanceof OcrError) {
    console.error(`OCR failed: ${error.message}`);
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   OcrModule                      │
│  ┌─────────────────────────────────────────┐    │
│  │              OcrService                  │    │
│  │  - extractText()                        │    │
│  │  - extractFromBuffer()                  │    │
│  │  - extractFromBase64()                  │    │
│  └──────────────────┬──────────────────────┘    │
│                     │                            │
│  ┌──────────────────▼──────────────────────┐    │
│  │           IOcrProvider                   │    │
│  │  (Strategy Interface)                    │    │
│  └──────────────────┬──────────────────────┘    │
│                     │                            │
│  ┌──────────────────▼──────────────────────┐    │
│  │        TesseractOcrProvider              │    │
│  │  - Lazy worker initialization           │    │
│  │  - In-process OCR                        │    │
│  │  - 100+ language support                 │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

## Integration with Documents Service

The OCR provider integrates with the documents service for text extraction:

```typescript
// In DocumentsService
async extractTextFromFile(userId: string, filename: string) {
  const mimeType = this.getMimeType(filename);

  if (mimeType.startsWith('image/')) {
    // Use OCR for images
    return this.ocrService.extractFromBuffer(buffer, mimeType);
  } else if (mimeType === 'application/pdf') {
    // Use PDF parser
    return this.extractionProvider.extractPdfText(buffer);
  } else if (mimeType.startsWith('text/')) {
    // Direct text read
    return buffer.toString('utf-8');
  }
}
```

## Testing

```bash
# Run unit tests
pnpm test

# Run with coverage
pnpm test -- --coverage
```

## License

MIT
