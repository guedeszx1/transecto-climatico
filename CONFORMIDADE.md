# Conformidade do Transecto Climático

Revisão interna de 09/11/2026 do site público em https://guedeszx1.github.io/transecto-climatico/. Não substitui parecer jurídico nem teste de invasão profissional.

**Legenda:** OK = implementado e verificado. N/A = não se aplica, pelo motivo indicado. VOCÊ = depende de ação do responsável.

O site é estático: sem login, banco de dados, API própria, cobrança, cookies ou coleta. Os arquivos são lidos no navegador, e só a preferência de tema fica salva nele.

## Segurança e proteção

| # | Item | Situação | Evidência |
|---|---|---|---|
| 1 | Autenticação segura | N/A | Não há login. A proteção da conta do GitHub está no item 38. |
| 2 | Controle de acesso | OK | Site só de leitura; só o responsável escreve no repositório. |
| 3 | Criptografia de dados | N/A | Nenhum dado é guardado ou enviado pelo site; transporte no item 4. |
| 4 | HTTPS / TLS | OK | HTTPS obrigatório no GitHub Pages; HTTP redireciona. |
| 5 | Hashing de senhas | N/A | Não há senhas. |
| 6 | SQL Injection | N/A | Não há banco de dados. |
| 7 | XSS / CSRF | OK | Dados de arquivo só como texto; CSP sem script inline; ataques com nome, colunas e KML maliciosos sem execução. CSRF não se aplica: não há sessão. |
| 8 | Rate Limiting | N/A | Não há API; o tráfego fica na infraestrutura do GitHub Pages. |
| 9 | Proteção de APIs | N/A | Não há API própria. |
| 10 | Auditoria de dependências | OK | Leaflet 1.9.4, JSZip 3.10.1 e SheetJS 0.20.3 verificados no OSV, diariamente. Dois alertas do SheetJS só atingem versões anteriores. |

## LGPD e privacidade

| # | Item | Situação | Evidência |
|---|---|---|---|
| 11 | Política de Privacidade | OK | `privacidade.html` |
| 12 | Bases legais | OK | O responsável não trata dados pessoais; explicado na política. Terceiros têm base própria. |
| 13 | Minimização de dados | OK | Nada é coletado. |
| 14 | Finalidades documentadas | OK | `privacidade.html` |
| 15 | Gestão de consentimento | N/A | Sem cookies, rastreamento ou coleta. |
| 16 | Política de Cookies | OK | Em `privacidade.html`: não há cookies; o armazenamento local guarda só a preferência de tema, sob a chave `tema` (verificado no navegador). |
| 17 | Direitos dos titulares | OK | Art. 18 explicado na política, com canal de contato. |
| 18 | Exclusão de dados | OK | Arquivos só na memória da aba; somem ao fechar. |
| 19 | Retenção de dados | OK | O responsável não retém dados. |
| 20 | Contratos com operadores | N/A | Nenhum operador contratado. GitHub, OpenStreetMap e Esri atuam sob suas próprias políticas, informadas na página. |

## Consumidor e negócios

| # | Item | Situação | Evidência |
|---|---|---|---|
| 21 | Termos de Uso | OK | `termos.html` |
| 22 | Transparência de preços | N/A | Gratuito, informado nos termos. |
| 23 | Cobranças transparentes | N/A | Sem cobrança. |
| 24 | Cancelamento de assinaturas | N/A | Sem assinatura. |
| 25 | Política de reembolso | N/A | Sem pagamento. |
| 26 | Identificação do fornecedor | OK | Nome e canal de contato em `privacidade.html`, `termos.html` e `desenvolvedor.html`. |
| 27 | Publicidade transparente | N/A | Sem publicidade. |
| 28 | Depoimentos autênticos | N/A | Sem depoimentos. |
| 29 | Licenças de uso | VOCÊ | Código próprio sob licença MIT (`LICENSE`). Bibliotecas e mapas em `licencas.html`, com textos em `vendor/`. Falta confirmar os termos da camada de satélite Esri. |
| 30 | Transparência dos cálculos | OK | `metodologia.html`: fórmulas, limitações e cada script. |

## Produção e responsabilidade

| # | Item | Situação | Evidência |
|---|---|---|---|
| 31 | Backups automatizados | OK | Código no GitHub; cópia diária com restic na máquina de origem. |
| 32 | Logs seguros | N/A | O site não gera logs; os do GitHub Pages não são acessíveis ao responsável. |
| 33 | Monitoramento de ameaças | OK | Alertas Dependabot, varredura de segredos, CodeQL e verificação diária do site. |
| 34 | Resposta a incidentes | OK | `INCIDENTES.md` |
| 35 | Notificação de incidentes | OK | `INCIDENTES.md`, com art. 48 da LGPD e Resolução CD/ANPD nº 15/2024. |
| 36 | Testes de segurança | OK | Testes automatizados, ataques em navegador real e CodeQL. Sem teste de invasão profissional. |
| 37 | Revisão de código | OK | Revisão independente interna e CodeQL. |
| 38 | Privilégios administrativos | OK | Um só administrador, com autenticação em dois fatores (informado pelo responsável em 08/11/2026); `main` sem force push nem exclusão. |
| 39 | Gestão de vulnerabilidades | OK | `SECURITY.md`, relato privado ativo e verificação diária. |
| 40 | Auditoria de conformidade | OK | Este documento. Revisão interna, sem certificação jurídica. |
