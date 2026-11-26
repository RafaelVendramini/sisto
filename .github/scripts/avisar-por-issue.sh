# Abre uma Issue de aviso automático ou, se já houver uma aberta com o mesmo
# título e o mesmo rótulo, só comenta nela (Issue #32). Assim, uma falha que se
# repete não gera uma Issue nova a cada execução.
#
# Uso: bash avisar-por-issue.sh <rótulo> <título> <arquivo-com-o-texto>
# Precisa de GH_TOKEN (permissão issues: write) e GITHUB_REPOSITORY, que o
# GitHub Actions já define.
set -euo pipefail

rotulo="$1"
titulo="$2"
arquivo_texto="$3"

# Cria o rótulo na primeira vez; se ele já existir, o erro é ignorado.
gh label create "$rotulo" --repo "$GITHUB_REPOSITORY" --color B60205 \
  --description 'Aviso automático do GitHub Actions (Issue #32)' 2>/dev/null || true

# Procura pelo título exato (comparado no jq, sem depender da busca do GitHub,
# que pode demorar para indexar uma Issue recém-aberta).
existente=$(TITULO="$titulo" gh issue list --repo "$GITHUB_REPOSITORY" --state open \
  --label "$rotulo" --limit 100 --json number,title \
  --jq '[.[] | select(.title == $ENV.TITULO)][0].number // empty')

if [ -n "$existente" ]; then
  gh issue comment "$existente" --repo "$GITHUB_REPOSITORY" --body-file "$arquivo_texto"
  echo "Comentado na Issue #$existente (aviso já aberto)."
else
  gh issue create --repo "$GITHUB_REPOSITORY" --title "$titulo" --label "$rotulo" \
    --body-file "$arquivo_texto"
fi
