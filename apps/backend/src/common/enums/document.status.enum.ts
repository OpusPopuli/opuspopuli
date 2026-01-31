import { registerEnumType } from '@nestjs/graphql';

export enum DocumentStatus {
  PROCESSINGNPENDING = 'Processing',
  TEXTEXTERACTIONSTARTED = 'Text Extraction Started',
  TEXTEXTERACTIONCOMPLETE = 'Text Extraction Complete',
  TEXTEXTERACTIONFAILED = 'Text Extraction Failed',
  AIEMBEDDINGSSTARTED = 'AI Embeddings Started',
  AIEMBEDDINGSCOMPLETE = 'AI Embeddings Complete',
  AIEMBEDDINGSFAILED = 'AI Embeddings Failed',
  AIANALYSISSTARTED = 'AI Analysis Started',
  AIANALYSISCOMPLETE = 'AI Analysis Complete',
  AIANALYSISFAILED = 'AI Analysis Failed',
  PROCESSINGNCOMPLETE = 'Complete',
}

registerEnumType(DocumentStatus, {
  name: 'DocumentStatus',
  description: 'Document processing status',
});
