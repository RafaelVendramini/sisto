// Conteúdo das páginas "Política de privacidade" e "Termos de uso" (#92).
// Texto provisório redigido pela equipe (primeiro comentário da Issue #92),
// revisado em 13/11/2026 para refletir o que o sistema de fato faz e atualizado em
// 24/11/2026 com o perfil Psicólogo escolar (Issue #154, SSD 1.18). Depois da homologação com a escola (#95), troque o
// texto SOMENTE neste arquivo; os componentes não precisam mudar.
//
// Formato:
// - cada documento tem `titulo`, `nota` (versão) e `secoes`;
// - cada seção tem `titulo` e `blocos`; um bloco é um parágrafo (string) ou
//   uma lista (`{ lista: [...] }`);
// - `**texto**` marca negrito; trechos "[A DEFINIR PELA ESCOLA...]" entre
//   `**` aparecem destacados na tela até a resposta da escola.
import { NOME_ESCOLA, TELEFONE_ESCOLA } from './escola.js';

/** Aviso exibido no topo das duas páginas até a aprovação registrada na ata da #95. */
export const AVISO_TEXTO_PROVISORIO = 'Texto provisório — a validar com a escola.';

/** Marcador dos trechos que dependem de decisão da escola. */
export const MARCADOR_A_DEFINIR = '[A DEFINIR PELA ESCOLA';

/** Nota de versão do documento, com a data da última revisão de cada um. */
function notaVersao(dataRevisao) {
  return `**Versão provisória para aprovação da escola** (versão provisória revisada em ${dataRevisao}). Os trechos marcados com **[A DEFINIR PELA ESCOLA]** dependem de decisão da direção ou da Diretoria de Ensino. Sugestões de mudança são bem-vindas em qualquer parte do texto.`;
}

// A Política de Privacidade foi revisada em 24/11/2026 (perfil Psicólogo
// escolar — Issue #154); os Termos de Uso não mudaram desde 13/11/2026.
export const NOTA_VERSAO_POLITICA_PRIVACIDADE = notaVersao('24/11/2026');
export const NOTA_VERSAO_TERMOS_USO = notaVersao('13/11/2026');

export const POLITICA_PRIVACIDADE = Object.freeze({
  titulo: 'Política de Privacidade',
  nota: NOTA_VERSAO_POLITICA_PRIVACIDADE,
  secoes: [
    {
      titulo: '1. Sobre este documento',
      blocos: [
        `O **Sisto** é o sistema de registro e acompanhamento de ocorrências escolares da **${NOME_ESCOLA}**. Esta política explica quais dados pessoais o sistema guarda, para quê, quem pode vê-los e como são protegidos, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).`,
        'O sistema é de **uso interno**: só funcionários da escola com conta criada pela Gestão conseguem entrar. Ele não é aberto ao público, a estudantes nem às famílias.',
      ],
    },
    {
      titulo: '2. Quem é responsável pelos dados',
      blocos: [
        {
          lista: [
            `**Controladora:** a ${NOME_ESCOLA}, que decide por que e como os dados são usados. **[A DEFINIR PELA ESCOLA: confirmar se o controlador é a escola ou a Secretaria da Educação do Estado de São Paulo.]**`,
            '**Encarregado pelo tratamento de dados (contato para dúvidas e pedidos):** **[A DEFINIR PELA ESCOLA: nome do cargo e canal de contato.]**',
            '**Equipe técnica:** a equipe de desenvolvimento do projeto mantém o sistema e só acessa os dados quando necessário para manutenção e segurança.',
          ],
        },
      ],
    },
    {
      titulo: '3. Quais dados o sistema guarda',
      blocos: [
        '**Dos funcionários (usuários):**',
        {
          lista: [
            'nome, e-mail institucional, perfil de acesso (Gestão, Equipe Pedagógica, Professor, Tutor, Psicólogo escolar ou Técnico-administrativo) e situação da conta (ativa, bloqueada ou desativada);',
            'a senha **nunca** é guardada: o sistema guarda só um código cifrado (hash) que não permite descobri-la.',
          ],
        },
        '**Dos estudantes:**',
        { lista: ['nome completo, código escolar, turma e professor tutor.'] },
        '**Das ocorrências:**',
        {
          lista: [
            'data, hora e local do fato, turma, categoria, estudantes envolvidos, descrição do ocorrido, demais envolvidos, testemunhas, providências imediatas e observações;',
            'encaminhamentos internos, responsável pelo acompanhamento, providências adotadas e status;',
            'no encaminhamento ao psicólogo escolar, a **justificativa** escrita por quem encaminhou, explicando por que o estudante precisa de acolhimento. Ela pode conter informações sensíveis, como dados de saúde ou emocionais, e por isso só pode ser lida por algumas pessoas (veja o item 5);',
            'registros de contatos feitos **fora** do sistema (por exemplo, com a família ou o Conselho Tutelar): com quem, por qual meio, quando e o que foi tratado. **O sistema não envia mensagens a ninguém.**',
          ],
        },
        '**Registros de segurança:**',
        {
          lista: [
            'histórico de cada ocorrência (quem fez cada alteração e quando);',
            'registro de atividades (auditoria): qual usuário fez qual ação, em qual registro e quando. Senhas e conteúdos das ocorrências não entram nesse registro.',
          ],
        },
        'O sistema **não** tem campo próprio para CPF, endereço, telefone ou dados de saúde, nem guarda fotos ou documentos. Porém, os campos de texto livre (descrição da ocorrência, justificativa ao psicólogo escolar, comunicações e providências) podem conter informações sensíveis, como dados de saúde, e dados de outras pessoas. Por isso, as descrições devem ser objetivas e conter só os dados pessoais necessários (o próprio formulário orienta isso).',
      ],
    },
    {
      titulo: '4. Para que os dados são usados',
      blocos: [
        'Somente para:',
        {
          lista: [
            'registrar e acompanhar ocorrências escolares, substituindo os formulários em papel;',
            'encaminhar cada ocorrência aos responsáveis internos e registrar as providências e os contatos realizados;',
            'gerar relatórios de **quantidade** de ocorrências por período, turma e categoria, para apoiar a gestão da escola;',
            'controlar o acesso e registrar atividades, para segurança e prestação de contas.',
          ],
        },
        'Os dados **não** são vendidos, não são usados para publicidade e não são compartilhados com outras empresas, exceto com os fornecedores de hospedagem, que só armazenam e processam os dados em nome da escola.',
        '**Base legal:** o tratamento se apoia no cumprimento das atribuições legais e de políticas públicas da escola (LGPD, art. 7º, II e III, e art. 23) e, para dados de crianças e adolescentes, no seu melhor interesse (art. 14). **[A DEFINIR PELA ESCOLA: validar a base legal com a Diretoria de Ensino, incluindo a base para dados sensíveis que possam aparecer nos campos de texto livre (LGPD, art. 11).]**',
      ],
    },
    {
      titulo: '5. Quem pode ver os dados',
      blocos: [
        'O acesso depende do perfil de cada usuário:',
        {
          lista: [
            '**Gestão e Equipe Pedagógica:** todas as ocorrências.',
            '**Tutor:** as ocorrências que registrou, as encaminhadas a ele, as que acompanha e as dos estudantes de quem é tutor.',
            '**Psicólogo escolar:** as ocorrências que registrou e as encaminhadas a ele.',
            '**Professor e Técnico-administrativo:** as ocorrências que registraram e as encaminhadas a eles.',
            'O código escolar dos estudantes e os e-mails dos funcionários aparecem só para a Gestão.',
            'A **justificativa do encaminhamento ao psicólogo escolar** aparece só para o psicólogo escolar que recebeu o encaminhamento, para a Gestão e para quem fez o encaminhamento. A Equipe Pedagógica e os demais usuários que veem a ocorrência sabem que ela foi encaminhada ao psicólogo, mas só leem a justificativa dos encaminhamentos que eles mesmos fizeram.',
          ],
        },
        'Cada usuário é responsável por não repassar o que vê no sistema (veja os Termos de Uso).',
      ],
    },
    {
      titulo: '6. Onde os dados ficam e como são protegidos',
      blocos: [
        {
          lista: [
            'O sistema funciona pela internet com conexão criptografada (HTTPS).',
            'O banco de dados fica, de preferência, em servidor de nuvem na região de São Paulo. A aplicação é hospedada em serviço de nuvem que pode processar os dados em servidores fora do Brasil. **[A DEFINIR PELA ESCOLA: confirmar os fornecedores, a região do ambiente definitivo e as garantias para a transferência de dados para fora do país (LGPD, art. 33). Confirmar também as cópias de segurança: hoje a cópia semanal é um procedimento da equipe na homologação, e o uso real depende da decisão sobre o plano contratado.]**',
            'O acesso exige e-mail e senha; a sessão expira em até 8 horas e termina ao fechar a aba.',
            'Por segurança, o sistema usa o endereço IP de forma temporária para limitar tentativas de acesso com senha errada. Essa contagem fica só na memória do servidor e é apagada em até 15 minutos.',
            'São feitas cópias de segurança periódicas, criptografadas e com acesso restrito.',
            'Enquanto o sistema estiver em teste (homologação), ele usa somente dados fictícios.',
          ],
        },
      ],
    },
    {
      titulo: '7. Cookies',
      blocos: [
        'O Sisto **não usa cookies**. Para manter o login, guarda apenas um código de acesso temporário e a identificação do usuário logado (nome e perfil) no próprio navegador, que são apagados ao sair ou ao fechar a aba. Não há ferramentas de estatística nem de publicidade.',
      ],
    },
    {
      titulo: '8. Por quanto tempo os dados ficam guardados',
      blocos: [
        'Os registros de ocorrências, estudantes, turmas e categorias **não são apagados pelo sistema**, para preservar o histórico escolar. Nesta primeira versão, os usuários, o histórico das ocorrências e os registros de auditoria também não são apagados. **[A DEFINIR PELA ESCOLA: prazo de guarda e o que fazer com os registros depois desse prazo, conforme as normas da rede estadual.]**',
        'As cópias de segurança são guardadas por um prazo **[A DEFINIR PELA ESCOLA: prazo de guarda das cópias de segurança.]**',
      ],
    },
    {
      titulo: '9. Direitos dos titulares',
      blocos: [
        'Estudantes (por meio de seus responsáveis legais) e funcionários podem pedir à escola, pelo encarregado indicado no item 2:',
        {
          lista: [
            'confirmação de que há dados seus no sistema e acesso a eles;',
            'correção de dados incompletos ou errados. Nas ocorrências, a correção é feita por um registro complementar (providência ou comunicação), porque o registro da ocorrência não é editado;',
            'eliminação ou anonimização de dados, respeitado o prazo legal de guarda dos registros escolares **[A DEFINIR PELA ESCOLA: prazo de guarda.]**;',
            'informações sobre com quem os dados foram compartilhados.',
          ],
        },
        'Os pedidos são analisados pela escola, considerando as obrigações legais de guarda dos registros escolares.',
        'O titular também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD) (LGPD, art. 18, § 1º).',
      ],
    },
    {
      titulo: '10. Alterações desta política',
      blocos: [
        'Esta política pode ser atualizada. A data da última versão aparece no topo da página.',
      ],
    },
  ],
});

export const TERMOS_USO = Object.freeze({
  titulo: 'Termos de Uso',
  nota: NOTA_VERSAO_TERMOS_USO,
  secoes: [
    {
      titulo: '1. Quem pode usar',
      blocos: [
        `O Sisto é de uso exclusivo de funcionários da ${NOME_ESCOLA}, com conta criada pela Gestão. Ao entrar no sistema, o usuário concorda com estes termos e com a Política de Privacidade.`,
      ],
    },
    {
      titulo: '2. Conta e senha',
      blocos: [
        {
          lista: [
            'A conta é **pessoal e intransferível**. Não compartilhe sua senha com ninguém, nem com colegas.',
            'No primeiro acesso e depois de uma redefinição, é obrigatório trocar a senha temporária.',
            'Use o botão **Sair** ao terminar, principalmente em computadores compartilhados.',
            'Se suspeitar que alguém usou sua conta, avise a Gestão imediatamente.',
          ],
        },
      ],
    },
    {
      titulo: '3. Como registrar',
      blocos: [
        {
          lista: [
            'Registre os fatos de forma **objetiva**, sem opiniões, apelidos ou julgamentos.',
            'Inclua só os dados pessoais **necessários** para entender a ocorrência.',
            'Registre apenas o que de fato aconteceu; informações falsas podem ter consequências administrativas.',
            'Contatos com famílias e outros órgãos são feitos **fora** do sistema; no Sisto, registre só que o contato aconteceu e o que foi tratado.',
          ],
        },
      ],
    },
    {
      titulo: '4. Sigilo',
      blocos: [
        'As informações do sistema são **sigilosas** e envolvem crianças e adolescentes. É proibido:',
        {
          lista: [
            'copiar, fotografar ou imprimir informações para repassá-las a pessoas não autorizadas;',
            'comentar o conteúdo das ocorrências fora do contexto profissional;',
            'usar os dados para qualquer finalidade que não seja o acompanhamento escolar.',
          ],
        },
      ],
    },
    {
      titulo: '5. Responsabilidades',
      blocos: [
        {
          lista: [
            'As inclusões e alterações feitas no sistema ficam registradas com o usuário, a data e a hora.',
            'O uso indevido pode levar ao bloqueio da conta e às medidas administrativas cabíveis. **[A DEFINIR PELA ESCOLA: citar o regimento ou a norma aplicável, se houver.]**',
            'O sistema pode ficar fora do ar em manutenções. Em caso de urgência, siga os procedimentos habituais da escola.',
          ],
        },
      ],
    },
    {
      titulo: '6. Contato',
      blocos: [
        `Dúvidas sobre o uso do sistema: procure a Gestão da escola. Telefone da escola: ${TELEFONE_ESCOLA}.`,
      ],
    },
  ],
});
