// Entrypoint for the Mercado Pago reconciler Edge Function.
// All logic lives in ./handler.ts so it can be tested with mocks without
// starting a server. Do not add business logic here.
import { handleRequest } from "./handler.ts";

Deno.serve((req) => handleRequest(req));
