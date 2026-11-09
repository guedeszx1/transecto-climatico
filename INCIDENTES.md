# Plano de resposta a incidentes

Responsável: Rafael Guedes.

## O que pode acontecer

O site não guarda dados de visitantes. Os cenários realistas são: alteração indevida do código publicado, conta do GitHub comprometida, biblioteca com falha grave ou erro de cálculo que afete resultados.

## Passos

1. **Confirmar:** o que aconteceu, quando e o que foi afetado.
2. **Conter:** se o site publicado estiver comprometido, despublicar em *Settings > Pages* ou com `gh api -X DELETE repos/guedeszx1/transecto-climatico/pages`.
3. **Proteger o acesso:** trocar a senha do GitHub, revogar tokens e sessões e conferir as chaves de acesso.
4. **Corrigir:** voltar ao último commit confiável ou aplicar a correção, e conferir o histórico do repositório.
5. **Publicar de novo** e testar o site.
6. **Avisar e registrar:** informar o ocorrido no repositório e registrar causa e correção. Erro de cálculo que afete resultados também é publicado, com as versões afetadas.

## Dados pessoais

O site não coleta dados pessoais, então um incidente no site, em regra, não os atinge. Se algum incidente envolver dados pessoais e puder causar risco ou dano relevante, avaliar a comunicação à ANPD e aos titulares, nos termos do art. 48 da LGPD e da Resolução CD/ANPD nº 15/2024: 3 dias úteis a partir do conhecimento de que dados pessoais foram afetados, em dobro para agentes de pequeno porte. Incidentes nos serviços de terceiros (GitHub, OpenStreetMap, Esri) são tratados por esses serviços.
