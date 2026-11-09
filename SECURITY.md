# Segurança

## Como relatar um problema

Use **Security > Report a vulnerability** neste repositório, que mantém o relato privado até haver correção. Não abra uma issue pública para falhas de segurança.

## O que o site é

Página estática, sem login, banco de dados, formulário ou servidor de processamento. Os arquivos enviados são lidos no navegador de quem usa.

## Proteções

| Área | Medida |
|---|---|
| Conteúdo de arquivos enviados | Tratado como dado, nunca como HTML ou código |
| Política de conteúdo (CSP) | Só scripts do próprio site, sem scripts inline |
| Arquivos grandes ou malformados | Limites de tamanho na leitura, incluindo KMZ descompactado |
| Transporte | HTTPS obrigatório pelo GitHub Pages |
| Dependências | Versões fixas, copiadas no repositório e verificadas diariamente |
| Código | Análise automática com CodeQL |
| Repositório | Alertas de vulnerabilidade, varredura de segredos e proteção contra force push na `main` |

Veja também [INCIDENTES.md](INCIDENTES.md).
