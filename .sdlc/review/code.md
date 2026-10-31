Opus Populi platform (NestJS microservices with GraphQL Federation, Next.js frontend; AGPL-3.0 with a
dual commercial licence). Block only on issues that would break production or the licence:

1. Critical bugs on hot paths: unhandled null/undefined, wrong database writes, a service querying
   another service's tables directly instead of going through Federation.
2. GPL-licensed dependency additions. They violate the AGPL dual-licence structure.
3. Breaking changes to the federated GraphQL schema or to the HMAC request-signing contract between
   the API Gateway and the microservices (`X-HMAC-Auth`).
4. Prompt text written inline. Prompt templates live only in the prompt-service repo and are consumed
   through `@opuspopuli/prompt-client`, keeping `promptHash` and `promptVersion` on the output row.

Code style and minor quality issues are not blocking.
