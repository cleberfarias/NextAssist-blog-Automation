# Runtime HeyGen MCP para Cloud Run

Este documento cobre o modo **interativo** do HeyGen no Harness: MCP, via OAuth, sem `HEYGEN_API_KEY`. Para o modo **headless** (pipeline automatizado, API REST com `HEYGEN_API_KEY` como secret de runtime), ver [HEYGEN_HYBRID_RUNTIME.md](HEYGEN_HYBRID_RUNTIME.md).

O bootstrap é `configureHeyGenMcpClient(...)` em `src/harness/heygenMcp.ts`. Ele recebe três dependências: o id do workspace, um `HeyGenOAuthSessionStore` e um `HeyGenMcpConnector`. O runtime não conhece endpoints de autorização, cliente OAuth, formato de refresh token ou detalhes de troca de códigos. Essas responsabilidades ficam no host MCP suportado pelo HeyGen.

## Execução local

Claude Code e Codex realizam o OAuth interativo do HeyGen. Um adaptador do host pode disponibilizar a sessão para o `HeyGenOAuthSessionStore`; o repositório não armazena tokens, arquivos de credencial ou segredos de OAuth.

## Cloud Run

Antes de operar em Cloud Run, implemente dois adaptadores externos ao domínio do Harness:

1. Um armazenamento apoiado no Secret Manager, com identidade de serviço de menor privilégio, que implemente `read`, `write` e `remove` para a sessão OAuth por workspace.
2. Um conector MCP que use a sessão recuperada e o cliente/fluxo OAuth oficialmente suportado pelo HeyGen. O conector deve informar rotação de sessão pelo callback `onSessionUpdated`.

Não registre tokens, respostas MCP, prompts com dados sensíveis ou cabeçalhos de autorização. O worker não tenta iniciar OAuth sozinho: sem sessão, ou com sessão expirada, retorna bloqueado e não conecta ao HeyGen. A criação de vídeo exige aprovação humana antes de chamar a ferramenta MCP descoberta pelo servidor.

O nome da ferramenta de criação é recebido na requisição depois da descoberta MCP; o código não pressupõe nomes de ferramentas ou endpoints não documentados.
