// Gera o material de treinamento do Sisto: 5 guias em HTML e PDF, um por perfil
// (Issue #142; guia do Psicólogo escolar na Issue #155; tutoria da PEI na Issue #162), e a visão geral da
// plataforma (Issue #146), com os prints de docs/treinamento/img (dados
// fictícios — RN05).
//
// Uso (na raiz do repositório, com o Google Chrome instalado):
//   node docs/treinamento/gerar-material.mjs
// Sem dependências: o PDF é impresso pelo Chrome em modo headless.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const PASTA = dirname(fileURLToPath(import.meta.url));
const SAIDA_HTML = join(PASTA, 'html');
const SAIDA_PDF = PASTA;
const ENDERECO = 'https://sisto.onrender.com';
const LOGO = readFileSync(join(PASTA, '..', 'apresentacao', 'logo-sisto-icone.svg'), 'utf8');

// ---------------------------------------------------------------------------
// Passos reutilizáveis. Cada passo: título, imagem e itens numerados (os
// números batem com os círculos vermelhos do print). "dica" é opcional.
// ---------------------------------------------------------------------------
const P = {
  entrar: {
    titulo: 'Entrar no Sisto',
    img: 'prof-01-entrar',
    intro: `Abra o navegador do celular (Chrome, por exemplo) e digite o endereço <b>${ENDERECO.replace('https://', '')}</b>.`,
    itens: ['Digite o seu <b>e-mail</b>.', 'Digite a sua <b>senha</b>. Ela aparece como bolinhas, por segurança.', 'Toque em <b>Entrar</b>.'],
    dica: 'O e-mail e a primeira senha são entregues pela Gestão da escola.',
  },
  primeiroAcesso: {
    titulo: 'Primeiro acesso: crie a sua senha',
    img: 'prof-02-primeiro-acesso',
    intro: 'Na primeira vez, o Sisto pede para você trocar a senha que recebeu da Gestão.',
    itens: ['Em <b>Senha atual</b>, digite a senha que você recebeu da Gestão.', 'Em <b>Nova senha</b>, crie uma senha com pelo menos 8 caracteres, diferente da que recebeu.', 'Em <b>Confirme a nova senha</b>, digite a senha nova de novo e toque em <b>Alterar senha</b>.'],
    dica: 'Depois disso, o Sisto volta para a tela de entrada. Entre com a senha nova.',
  },
  inicioProfessor: {
    titulo: 'A tela inicial',
    img: 'prof-03-inicio',
    intro: 'Depois de entrar, use o menu no alto da tela.',
    itens: ['<b>Ocorrências</b>: as ocorrências que você registrou.', '<b>Registrar ocorrência</b>: abre o formulário para registrar um fato novo.'],
  },
  // Orientações de tutoria da PEI (Issue #162), confirmadas pela escola em 24/11/2026.
  tutoriaTutor: {
    titulo: 'Tutoria na PEI',
    cartoes: [
      ['Este é o guia dos professores', 'Na escola de período integral (PEI), <b>todo professor é tutor</b>. Por isso, os professores entram no Sisto com o perfil <b>Tutor</b>.'],
      ['Os seus tutorados', 'Cada aluno escolhe o seu tutor, e a Gestão registra a escolha no Sisto. Você vê <b>todas as ocorrências dos alunos que escolheram você</b>, mesmo as registradas por outra pessoa.'],
      ['Quando o aluno troca de tutor', 'As ocorrências dele passam para o novo tutor, inclusive as antigas. Você deixa de vê-las, a não ser as que você registrou, as que foram encaminhadas a você e as que você ainda acompanha como responsável.'],
    ],
  },
  tutoriaGestao: {
    titulo: 'Tutoria na PEI',
    cartoes: [
      ['Todo professor é tutor', 'Na PEI, cadastre <b>todos os professores com o perfil Tutor</b>. O perfil Professor fica para exceções, por exemplo um professor eventual que não tem tutorados.'],
      ['Ligar o aluno ao tutor', 'O aluno escolhe o tutor. Se o professor aceitar, em <b>Estudantes</b>, escolha esse professor em <b>Professor tutor</b>. Se o professor recusar, o aluno escolhe outro.'],
      ['Trocar o tutor', 'O aluno pode trocar de tutor mais de uma vez no ano. Em <b>Estudantes</b>, toque em <b>Editar</b> e escolha o novo <b>Professor tutor</b>. O novo tutor passa a ver todas as ocorrências do aluno, inclusive as antigas, e o anterior deixa de vê-las.'],
      ['Atenção às ocorrências em andamento', 'Se o tutor anterior era o <b>responsável pelo acompanhamento</b> de uma ocorrência não encerrada, ele continua responsável. Abra a ocorrência e toque em <b>Encaminhar</b>, escolhendo o novo tutor como responsável.'],
    ],
  },
  tutoriaPedagogico: {
    titulo: 'Tutoria na PEI',
    cartoes: [
      ['Todo professor é tutor', 'Na PEI, os professores usam o perfil <b>Tutor</b>, e cada aluno é ligado ao tutor que escolheu. Quem registra a escolha e as trocas é a <b>Gestão</b>.'],
      ['Depois de uma troca de tutor', 'O novo tutor passa a ver as ocorrências do aluno, mas o <b>responsável pelo acompanhamento</b> não muda sozinho. Nas ocorrências não encerradas, toque em <b>Encaminhar</b> e escolha o novo tutor como responsável.'],
    ],
  },
  inicioTutor: {
    titulo: 'A tela inicial',
    img: 'tutor-00-inicio',
    intro: 'Depois de entrar, use o menu no alto da tela.',
    itens: ['<b>Ocorrências</b>: as ocorrências que você pode ver e acompanhar.', '<b>Registrar ocorrência</b>: abre o formulário para registrar um fato novo.'],
  },
  reg1: {
    titulo: 'Registrar: turma e estudantes',
    img: 'prof-04-turma-estudantes',
    secao: 'Registrar uma ocorrência (1 de 6)',
    itens: ['Toque em <b>Turma da ocorrência</b> e escolha a turma.', '<b>Marque</b> o quadradinho de cada estudante envolvido. Pode marcar mais de um.'],
    dica: 'Os estudantes marcados aparecem logo abaixo, em "Estudantes envolvidos".',
  },
  reg2: {
    titulo: 'Registrar: o que aconteceu',
    img: 'prof-05-categoria-descricao',
    secao: 'Registrar uma ocorrência (2 de 6)',
    itens: ['Escolha a <b>Categoria</b> (por exemplo: Conflitos, Indisciplina, Bullying).', 'Em <b>Descrição do fato</b>, conte o que aconteceu.'],
    dica: 'Escreva só os fatos, sem opiniões, apelidos ou palavras ofensivas.',
  },
  reg3: {
    titulo: 'Registrar: quando e onde',
    img: 'prof-06-data-local',
    secao: 'Registrar uma ocorrência (3 de 6)',
    itens: ['A <b>Data e hora do fato</b> já vem preenchida com o momento atual. Se o fato aconteceu antes, ajuste.', 'Em <b>Local</b>, escreva onde aconteceu (sala de aula, pátio, quadra...).'],
  },
  reg4: {
    titulo: 'Registrar: outras informações',
    img: 'prof-07-opcionais',
    secao: 'Registrar uma ocorrência (4 de 6)',
    intro: 'Estes campos são <b>opcionais</b>. Preencha só se tiver a informação.',
    itens: [],
    lista: ['<b>Demais envolvidos</b>: outras pessoas que participaram.', '<b>Testemunhas</b>: quem viu o fato.', '<b>Providências imediatas</b>: o que você já fez na hora.', '<b>Observações</b>: algo mais que seja importante.'],
  },
  reg5: {
    titulo: 'Registrar: para quem encaminhar',
    img: 'prof-08-destinatario',
    secao: 'Registrar uma ocorrência (5 de 6)',
    intro: 'Escolha quem vai receber a ocorrência.',
    itens: ['Em <b>Encaminhar para</b>, escolha <b>Tutor</b>, <b>Psicólogo escolar</b>, <b>Equipe pedagógica</b> ou <b>Gestão</b>.', 'Se escolheu <b>Tutor</b>, escolha qual tutor vai receber.'],
    dica: 'Para encaminhar a mais de uma pessoa, toque em "Adicionar destinatário".',
  },
  regPsicologo: {
    titulo: 'Registrar: encaminhar ao psicólogo escolar',
    img: 'comum-encaminhar-psicologo',
    secao: 'Registrar uma ocorrência (5 de 6)',
    intro: 'Se você percebeu algo emocional ou de comportamento e o estudante precisa de acolhimento, encaminhe também ao psicólogo escolar.',
    itens: ['Em <b>Encaminhar para</b>, escolha <b>Psicólogo escolar</b>.', 'Escolha o <b>psicólogo</b> que vai receber.', 'Escreva a <b>Justificativa</b>: o que você observou e por que o estudante precisa de acolhimento. Ela é obrigatória.'],
    dica: 'A justificativa é sigilosa: só o psicólogo escolar, a Gestão e você a leem. Escreva só fatos, sem rótulos nem diagnósticos.',
  },
  trocarDestinatario: {
    titulo: 'Mudou de ideia? A justificativa é apagada',
    img: 'comum-trocar-destinatario',
    secao: 'Registrar uma ocorrência (5 de 6)',
    intro: 'Se você já escreveu a justificativa e trocar o destinatário para outra opção, o Sisto pergunta antes de apagar o texto.',
    itens: ['<b>Não, manter como está</b>: continua com o psicólogo escolar e com o texto.', '<b>Sim, apagar e trocar</b>: apaga a justificativa e troca o destinatário.'],
    dica: 'Assim a justificativa, que é sigilosa, não vira uma observação que todos podem ler.',
  },
  justificativaOculta: {
    titulo: 'Justificativa protegida',
    img: 'comum-justificativa-oculta',
    intro: 'Nos detalhes da ocorrência, em <b>Encaminhamentos</b>, você vê se ela foi encaminhada ao psicólogo escolar.',
    itens: ['Se a justificativa não foi escrita por você, aparece este <b>aviso</b> no lugar do texto.'],
    dica: 'A justificativa fala de questões emocionais do estudante. Por isso, só o psicólogo escolar, a Gestão e quem fez o encaminhamento a leem (LGPD).',
  },
  justificativaOcultaPedagogico: {
    titulo: 'Justificativa protegida',
    img: 'comum-justificativa-oculta',
    intro: 'Nos detalhes da ocorrência, em <b>Encaminhamentos</b>, você vê se ela foi encaminhada ao psicólogo escolar.',
    itens: ['A Equipe Pedagógica só lê a justificativa dos encaminhamentos que <b>ela mesma fez</b>. Nos demais, aparece este <b>aviso</b> no lugar do texto.'],
    dica: 'A justificativa fala de questões emocionais do estudante. Por isso, só o psicólogo escolar, a Gestão e quem fez o encaminhamento a leem (LGPD).',
  },
  inicioPsicologo: {
    titulo: 'A tela inicial',
    img: 'psi-01-inicio',
    intro: 'Depois de entrar, use o menu no alto da tela.',
    itens: ['<b>Ocorrências</b>: as encaminhadas a você e as que você registrou.', '<b>Registrar ocorrência</b>: abre o formulário para registrar um fato novo.'],
  },
  psiLista: {
    titulo: 'As ocorrências encaminhadas a você',
    img: 'psi-02-lista',
    intro: 'Em <b>Ocorrências</b>, você vê as que foram encaminhadas a você e as que você registrou. As demais ocorrências da escola não aparecem.',
    itens: ['Toque no <b>número da ocorrência</b> para ver todos os detalhes.'],
  },
  psiJustificativa: {
    titulo: 'Ler a justificativa',
    img: 'psi-03-justificativa',
    intro: 'Role a tela até <b>Encaminhamentos</b>.',
    itens: ['A <b>Justificativa</b> conta o que foi observado e por que o estudante precisa de acolhimento.'],
    dica: 'A justificativa é sigilosa: só você, a Gestão e quem fez o encaminhamento a leem.',
  },
  psiAcoes: {
    titulo: 'O que você pode fazer na ocorrência',
    img: 'psi-04-acoes',
    itens: ['<b>Registrar comunicação</b>: anotar um contato que você fez (com a família, o estudante ou a rede de proteção).'],
    dica: 'O psicólogo escolar não encaminha, não registra providências e não encerra ocorrências: isso fica com a Equipe Pedagógica, a Gestão ou o responsável pelo acompanhamento.',
  },
  reg6: {
    titulo: 'Registrar: enviar',
    img: 'prof-09-botao-registrar',
    secao: 'Registrar uma ocorrência (6 de 6)',
    itens: ['Confira tudo e toque em <b>Registrar ocorrência</b>.'],
    dica: 'Se faltar alguma informação obrigatória, o Sisto mostra uma mensagem em vermelho no campo que falta.',
  },
  registrada: {
    titulo: 'Pronto! Ocorrência registrada',
    img: 'prof-10-registrada',
    itens: ['O Sisto mostra o <b>número da ocorrência</b>. Anote, se quiser acompanhar depois.'],
    dica: 'Uma ocorrência registrada não pode ser editada. Confira tudo antes de tocar em "Registrar ocorrência".',
  },
  lista: {
    titulo: 'Ver as ocorrências',
    img: 'prof-11-lista',
    intro: 'Toque em <b>Ocorrências</b> no menu. Elas aparecem pela data do fato, da mais recente para a mais antiga.',
    itens: ['Toque no <b>número da ocorrência</b> para ver todos os detalhes.'],
    lista: ['<b>Aberto</b>: registrada, aguardando atendimento.', '<b>Em acompanhamento</b>: alguém já está cuidando do caso.', '<b>Encerrado</b>: o caso foi finalizado.'],
  },
  detalhe: {
    titulo: 'Os detalhes da ocorrência',
    img: 'prof-12-detalhe',
    itens: ['O <b>Status</b> mostra em que situação a ocorrência está.'],
    dica: 'Role a tela para baixo para ver estudantes, encaminhamentos, comunicações e providências.',
  },
  historico: {
    titulo: 'O histórico',
    img: 'prof-13-historico',
    itens: ['No fim da página fica o <b>Histórico</b>: tudo o que aconteceu com a ocorrência, com data, hora e quem fez.'],
  },
  alterarSenha: {
    titulo: 'Trocar a sua senha',
    img: 'prof-14-alterar-senha',
    intro: 'No alto da tela, toque em <b>Alterar minha senha</b>.',
    itens: ['Digite a <b>senha atual</b>.', 'Digite a <b>senha nova</b> (pelo menos 8 caracteres, diferente da atual).', 'Repita a <b>senha nova</b> e toque em <b>Alterar senha</b>.'],
    dica: 'Depois de trocar, o Sisto pede para você entrar de novo, com a senha nova.',
  },
  sair: {
    titulo: 'Sair do Sisto',
    img: 'prof-15-sair',
    itens: ['Toque em <b>Sair</b>, no alto da tela.'],
    dica: 'Sempre saia quando usar um computador ou celular de outra pessoa.',
  },
  tutorLista: {
    titulo: 'As ocorrências que você acompanha',
    img: 'tutor-01-lista',
    intro: 'Em <b>Ocorrências</b>, você vê as que registrou, as encaminhadas a você, as que você acompanha e as dos seus tutorados.',
    itens: ['<b>Em acompanhamento</b>: você ou outra pessoa está cuidando do caso.'],
  },
  filtros: {
    titulo: 'Procurar uma ocorrência',
    img: 'tutor-02-filtros',
    intro: 'Toque em <b>Mostrar filtros</b> para procurar por estudante, turma, categoria, status ou período.',
    itens: ['Escolha, por exemplo, o <b>Status</b>.', 'Toque em <b>Filtrar</b>.'],
    dica: 'Para ver tudo de novo, toque em "Limpar filtros".',
  },
  tutorAcoes: {
    titulo: 'O que você pode fazer na ocorrência',
    img: 'tutor-03-acoes',
    intro: 'Quando a ocorrência está <b>Em acompanhamento</b> e você é o <b>responsável pelo acompanhamento</b>, aparecem estes botões:',
    itens: ['<b>Registrar comunicação</b>: anotar um contato com a família ou outra pessoa.', '<b>Registrar providência</b>: anotar o que foi feito.', '<b>Encerrar ocorrência</b>: quando o caso estiver resolvido.'],
    dica: 'Se você não for o responsável, aparece só "Registrar comunicação". Numa ocorrência encerrada, não aparece nenhum botão.',
  },
  comunicacao: {
    titulo: 'Registrar uma comunicação',
    img: 'tutor-04-comunicacao',
    intro: 'Use para anotar um contato que você <b>já fez</b> (ligação, mensagem, conversa). O Sisto <b>não</b> envia mensagens.',
    itens: ['<b>Destinatário</b>: com quem você falou (ex.: mãe do estudante).', '<b>Meio</b>: como falou (telefone, WhatsApp, pessoalmente...).', '<b>Descrição</b>: o que foi conversado, de forma objetiva.'],
  },
  comunicacao2: {
    titulo: 'Registrar uma comunicação: enviar',
    img: 'tutor-05-comunicacao-enviar',
    itens: ['Confira a <b>Data e hora do contato</b>. Ajuste se foi antes.', 'Toque em <b>Registrar</b>.'],
  },
  providencia: {
    titulo: 'Registrar uma providência',
    img: 'tutor-06-providencia',
    intro: 'Toque em <b>Registrar providência</b> e conte o que foi feito.',
    itens: ['Escreva a <b>providência</b> (ex.: conversa com o estudante e a família).', 'Toque em <b>Registrar</b>.'],
    dica: 'Este botão só aparece com a ocorrência <b>Em acompanhamento</b>. Para encerrar, ela precisa ter pelo menos uma providência.',
  },
  encerrar: {
    titulo: 'Encerrar a ocorrência',
    img: 'tutor-07-encerrar',
    intro: 'Quando o caso estiver resolvido, toque em <b>Encerrar ocorrência</b>.',
    itens: ['Confirme tocando em <b>Encerrar ocorrência</b> de novo.'],
    dica: 'Atenção: uma ocorrência encerrada <b>não pode ser reaberta</b>.',
  },
  encerrada: {
    titulo: 'Ocorrência encerrada',
    img: 'tutor-08-encerrada',
    itens: ['O Sisto avisa que a ocorrência foi encerrada.', 'O status muda para <b>Encerrado</b>.'],
  },
  inicioPedagogico: {
    titulo: 'A tela inicial',
    img: 'ped-01-inicio',
    intro: 'Depois de entrar, use o menu no alto da tela.',
    itens: ['<b>Ocorrências</b>: todas as ocorrências da escola.', '<b>Categorias</b>: os tipos de ocorrência.', '<b>Relatórios</b>: quantidade de ocorrências por período, turma ou categoria.'],
    dica: '"Registrar ocorrência" funciona como no passo a passo deste guia.',
  },
  encaminharAcoes: {
    titulo: 'Encaminhar uma ocorrência',
    img: 'ped-02-acoes',
    intro: 'Abra a ocorrência e toque em <b>Encaminhar</b>.',
    itens: ['<b>Encaminhar</b>: envia o caso e define quem vai acompanhá-lo.'],
  },
  encaminhar: {
    titulo: 'Encaminhar: preencher',
    img: 'ped-03-encaminhar',
    itens: ['Em <b>Encaminhar para</b>, escolha Tutor, Psicólogo escolar, Equipe pedagógica ou Gestão. Se for Tutor ou Psicólogo escolar, escolha a pessoa; se for uma equipe, pode deixar "Toda a equipe".', 'Escolha o <b>Responsável pelo acompanhamento</b>: quem vai cuidar do caso. O psicólogo escolar não pode ser o responsável.', 'Se quiser, escreva uma <b>Observação</b>. Para o psicólogo escolar, a <b>Justificativa</b> é obrigatória.'],
  },
  encaminhar2: {
    titulo: 'Encaminhar: enviar',
    img: 'ped-04-encaminhar-enviar',
    itens: ['Toque em <b>Encaminhar</b>.'],
  },
  emAcompanhamento: {
    titulo: 'A ocorrência está em acompanhamento',
    img: 'ped-05-em-acompanhamento',
    itens: ['O status muda para <b>Em acompanhamento</b> e o responsável já pode registrar providências.'],
    dica: 'Para trocar o responsável, encaminhe de novo escolhendo outra pessoa.',
  },
  relatorio: {
    titulo: 'Gerar um relatório',
    img: 'ped-06-relatorio',
    intro: 'No menu, toque em <b>Relatórios</b>.',
    itens: ['Escolha o <b>Tipo de relatório</b>: total do período, por turma ou por categoria.', 'Em <b>De</b>, escolha a primeira data do período.', 'Em <b>Até</b>, escolha a última data.', 'Toque em <b>Gerar relatório</b>.'],
  },
  relatorio2: {
    titulo: 'O resultado do relatório',
    img: 'ped-07-relatorio-resultado',
    intro: 'O Sisto mostra uma tabela com as quantidades.',
    itens: ['Toque em <b>Imprimir</b> para imprimir ou salvar em PDF.'],
  },
  categorias: {
    titulo: 'Cadastrar uma categoria',
    img: 'ped-08-categorias',
    intro: 'No menu, toque em <b>Categorias</b>. As categorias são os tipos de ocorrência.',
    itens: ['Digite o <b>nome</b> da categoria nova.', 'Toque em <b>Cadastrar categoria</b>.'],
    dica: 'Categorias não são apagadas: elas podem ser editadas.',
  },
  inicioGestao: {
    titulo: 'A tela inicial',
    img: 'gestao-01-inicio',
    intro: 'A Gestão tem acesso a todo o Sisto. Além do que a Equipe Pedagógica faz:',
    itens: ['<b>Usuários</b>: cadastrar, bloquear e redefinir senhas.', '<b>Turmas</b>: cadastrar e editar as turmas.', '<b>Estudantes</b>: cadastrar estudantes e escolher o tutor.'],
  },
  usuario: {
    titulo: 'Cadastrar um usuário',
    img: 'gestao-02-cadastrar-usuario',
    intro: 'No menu, toque em <b>Usuários</b>.',
    itens: ['<b>Nome completo</b> da pessoa.', '<b>E-mail</b>: será usado para entrar no Sisto.', '<b>Perfil</b>: Professor, Tutor, Psicólogo escolar, Gestão, Pedagógico ou Técnico-administrativo.', '<b>Senha temporária</b>: a pessoa troca no primeiro acesso.'],
    dica: 'Na PEI, todo professor é tutor: cadastre os professores com o perfil <b>Tutor</b>.',
  },
  usuario2: {
    titulo: 'Cadastrar um usuário: enviar',
    img: 'gestao-03-cadastrar-usuario-botao',
    itens: ['Toque em <b>Cadastrar usuário</b>.'],
    dica: 'Entregue o e-mail e a senha temporária à pessoa de forma reservada.',
  },
  usuarioAcoes: {
    titulo: 'Cuidar dos usuários',
    img: 'gestao-04-acoes-usuario',
    intro: 'Na lista de usuários, cada pessoa tem estes botões:',
    itens: ['<b>Editar</b>: mudar nome, e-mail ou perfil.', '<b>Bloquear</b>: a pessoa deixa de entrar na hora.', '<b>Desativar</b>: também corta o acesso, por exemplo para quem saiu da escola.', '<b>Redefinir senha</b>: quando alguém esqueceu a senha.'],
    dica: 'Bloquear e Desativar podem ser desfeitos com "Reativar", e os registros da pessoa continuam guardados. Se a pessoa for tutor de estudantes ou responsável por ocorrências abertas, o Sisto pode não deixar trocar o perfil.',
  },
  redefinir: {
    titulo: 'Redefinir a senha de alguém',
    img: 'gestao-05-redefinir-senha',
    itens: ['Digite a <b>nova senha temporária</b> e toque em <b>Redefinir senha</b>.'],
    dica: 'No próximo acesso, a pessoa é obrigada a criar uma senha nova.',
  },
  bloquear: {
    titulo: 'Bloquear ou desativar: confirmar',
    img: 'gestao-06-bloquear',
    itens: ['Confirme tocando em <b>Bloquear acesso</b> (ou em <b>Desativar usuário</b>).'],
    dica: 'Ninguém pode bloquear ou desativar a si mesmo. O Sisto também precisa ter sempre <b>duas pessoas da Gestão ativas</b>: se houver só duas, cadastre outra antes de bloquear uma delas.',
  },
  turma: {
    titulo: 'Cadastrar uma turma',
    img: 'gestao-07-turma',
    intro: 'No menu, toque em <b>Turmas</b>.',
    itens: ['<b>Nome</b> da turma (ex.: 8º C).', '<b>Etapa</b> (ex.: Ensino Fundamental - Anos Finais).', '<b>Ano letivo</b>.', 'Toque em <b>Cadastrar turma</b>.'],
  },
  estudante: {
    titulo: 'Cadastrar um estudante',
    img: 'gestao-08-estudante',
    intro: 'No menu, toque em <b>Estudantes</b>.',
    itens: ['<b>Nome completo</b> do estudante.', '<b>Código escolar</b> (opcional).', '<b>Turma</b>.', '<b>Professor tutor</b> (opcional): quem acompanha o estudante.'],
    dica: 'Depois, toque em "Cadastrar estudante". Estudantes não são apagados: podem ser editados ou trocar de turma.',
  },
};

// Telas de computador (uma página com dois prints lado a lado ou um só).
const COMPUTADOR = {
  professor: ['prof-16-computador-lista', 'prof-17-computador-registrar'],
  tutor: ['tutor-10-computador-lista', 'tutor-09-computador-detalhe'],
  pedagogico: ['ped-10-computador-lista', 'ped-09-computador-relatorio'],
  gestao: ['gestao-09-computador-usuarios', 'gestao-10-computador-turmas'],
  psicologo: ['psi-05-computador-lista', 'psi-06-computador-detalhe'],
};

// [pergunta, resposta, imagem (opcional), guias em que aparece (opcional; padrão: todos)].
// A resposta pode ser um objeto { padrao, <id do guia>: texto } quando muda por perfil.
const PROBLEMAS_COMUNS = [
  ['Esqueci a minha senha.', {
    padrao: 'Procure a <b>Gestão</b> da escola. Ela cria uma senha temporária para você, e no próximo acesso você escolhe uma senha nova.',
    gestao: 'Peça a <b>outra pessoa da Gestão</b> para redefinir a sua senha. No próximo acesso, você escolhe uma senha nova.',
  }],
  ['Apareceu "E-mail ou senha inválidos".', 'Confira o e-mail e digite a senha de novo, com atenção às letras maiúsculas e minúsculas.'],
  ['Errei a senha várias vezes e apareceu "Muitas tentativas".', 'Depois de 5 senhas erradas, o Sisto pede para esperar. Aguarde até <b>15 minutos</b> e tente de novo. A sua conta não fica bloqueada.'],
  ['O Sisto demorou para abrir.', 'Fora do horário da escola (antes das 7h, depois das 20h e nos fins de semana), a primeira abertura pode levar <b>até 1 minuto</b>. Aguarde, sem fechar a página.'],
  ['Apareceu "Não foi possível conectar ao servidor".', 'Confira a internet do celular (Wi-Fi ou dados móveis) e tente de novo.'],
  ['Apareceu "Sua sessão expirou".', 'Por segurança, a entrada vale por até <b>8 horas</b>. O que você escreveu continua na tela (1): copie o texto, se precisar. Toque em <b>Entrar novamente</b> (2). O Sisto volta para a mesma tela: cole o texto e envie de novo.', 'comum-sessao-expirada'],
  ['Apertei sem querer para fechar uma janela com texto.', 'O Sisto pergunta antes de descartar. Toque em <b>Continuar editando</b> (1) para voltar ao texto, ou em <b>Descartar</b> (2) se quiser apagar.', 'comum-descartar-texto', ['tutor', 'pedagogico', 'gestao', 'psicologo']],
  ['Registrei uma ocorrência com um erro.', 'Ninguém pode editar uma ocorrência depois de registrada. Avise a <b>Equipe Pedagógica</b> ou a <b>Gestão</b>, que vão orientar o que fazer.', null, ['professor', 'tutor', 'psicologo']],
];

const GUIAS = [
  {
    id: 'professor',
    arquivo: 'Guia-Sisto-Professor-e-Tecnico-administrativo',
    titulo: 'Professor e Técnico-administrativo',
    resumo: ['Entrar e criar a sua senha', 'Registrar uma ocorrência, passo a passo', 'Encaminhar ao psicólogo escolar, com justificativa', 'Ver as ocorrências que você registrou', 'Trocar a sua senha e sair'],
    passos: ['entrar', 'primeiroAcesso', 'inicioProfessor', 'reg1', 'reg2', 'reg3', 'reg4', 'reg5', 'regPsicologo', 'trocarDestinatario', 'reg6', 'registrada', 'lista', 'detalhe', 'justificativaOculta', 'historico', 'alterarSenha', 'sair'],
  },
  {
    id: 'tutor',
    arquivo: 'Guia-Sisto-Tutor',
    titulo: 'Tutor',
    resumo: ['Entrar e registrar ocorrências', 'Encaminhar ao psicólogo escolar, com justificativa', 'Acompanhar as ocorrências dos seus tutorados', 'Registrar comunicações e providências', 'Encerrar uma ocorrência'],
    passos: ['entrar', 'primeiroAcesso', 'inicioTutor', 'tutoriaTutor', 'reg1', 'reg2', 'reg3', 'reg4', 'reg5', 'regPsicologo', 'trocarDestinatario', 'reg6', 'registrada', 'tutorLista', 'filtros', 'detalhe', 'justificativaOculta', 'tutorAcoes', 'comunicacao', 'comunicacao2', 'providencia', 'encerrar', 'encerrada', 'historico', 'alterarSenha', 'sair'],
  },
  {
    id: 'pedagogico',
    arquivo: 'Guia-Sisto-Equipe-Pedagogica',
    titulo: 'Equipe Pedagógica',
    resumo: ['Ver e procurar todas as ocorrências', 'Encaminhar (inclusive ao psicólogo escolar) e definir quem acompanha', 'Comunicações, providências e encerramento', 'Relatórios e categorias'],
    passos: ['entrar', 'primeiroAcesso', 'inicioPedagogico', 'reg1', 'reg2', 'reg3', 'reg4', 'reg5', 'regPsicologo', 'trocarDestinatario', 'reg6', 'registrada', 'lista', 'filtros', 'detalhe', 'justificativaOcultaPedagogico', 'encaminharAcoes', 'encaminhar', 'encaminhar2', 'emAcompanhamento', 'tutoriaPedagogico', 'comunicacao', 'comunicacao2', 'providencia', 'encerrar', 'encerrada', 'historico', 'relatorio', 'relatorio2', 'categorias', 'alterarSenha', 'sair'],
  },
  {
    id: 'gestao',
    arquivo: 'Guia-Sisto-Gestao',
    titulo: 'Gestão',
    resumo: ['Tudo o que a Equipe Pedagógica faz', 'Cadastrar usuários (inclusive o psicólogo escolar), bloquear e redefinir senhas', 'Cadastrar turmas e estudantes (com o tutor)', 'Relatórios e categorias'],
    passos: ['entrar', 'primeiroAcesso', 'inicioGestao', 'usuario', 'usuario2', 'usuarioAcoes', 'redefinir', 'bloquear', 'turma', 'estudante', 'tutoriaGestao', 'reg1', 'reg2', 'reg3', 'reg4', 'reg5', 'regPsicologo', 'trocarDestinatario', 'reg6', 'registrada', 'lista', 'filtros', 'detalhe', 'encaminharAcoes', 'encaminhar', 'encaminhar2', 'emAcompanhamento', 'comunicacao', 'comunicacao2', 'providencia', 'encerrar', 'encerrada', 'historico', 'relatorio', 'relatorio2', 'categorias', 'alterarSenha', 'sair'],
  },
  {
    id: 'psicologo',
    arquivo: 'Guia-Sisto-Psicologo-Escolar',
    titulo: 'Psicólogo escolar',
    resumo: ['Entrar e criar a sua senha', 'Ver as ocorrências encaminhadas a você', 'Ler a justificativa e registrar comunicações', 'Registrar ocorrências, trocar a senha e sair'],
    passos: ['entrar', 'primeiroAcesso', 'inicioPsicologo', 'psiLista', 'detalhe', 'psiJustificativa', 'psiAcoes', 'comunicacao', 'comunicacao2', 'historico', 'reg1', 'reg2', 'reg3', 'reg4', 'reg5', 'reg6', 'registrada', 'alterarSenha', 'sair'],
  },
];

// ---------------------------------------------------------------------------
const CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; color: #1b2433; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pagina { width: 210mm; height: 297mm; padding: 14mm 14mm 12mm; position: relative; overflow: hidden; page-break-after: always; break-after: page; }
.pagina:last-child { page-break-after: auto; break-after: auto; }
.topo { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #88185d; padding-bottom: 3mm; margin-bottom: 6mm; font-size: 11pt; color: #88185d; font-weight: 600; }
.topo .marca { display: flex; align-items: center; gap: 2mm; }
.topo .marca svg { width: 7mm; height: 7mm; }
.rodape { position: absolute; left: 14mm; right: 14mm; bottom: 7mm; display: flex; justify-content: space-between; font-size: 9.5pt; color: #5b6575; }
h1 { font-size: 26pt; color: #88185d; margin: 0 0 3mm; line-height: 1.1; }
.secao { display: inline-block; background: #f8e6ef; color: #88185d; font-weight: 700; font-size: 10.5pt; border-radius: 20px; padding: 1mm 4mm; margin-bottom: 3mm; }
.passo { display: grid; grid-template-columns: 92mm 1fr; gap: 9mm; align-items: start; }
.passo img { width: 92mm; border: 1.5px solid #d9dee8; border-radius: 6mm; box-shadow: 0 2mm 5mm rgba(0,0,0,.12); }
.texto { font-size: 15pt; line-height: 1.4; }
.texto .intro { margin: 0 0 5mm; }
.itens { list-style: none; padding: 0; margin: 0 0 5mm; }
.itens li { display: grid; grid-template-columns: 10mm 1fr; gap: 3mm; margin-bottom: 4.5mm; align-items: start; }
.num { width: 9mm; height: 9mm; border-radius: 50%; background: #e6371e; color: #fff; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 13pt; margin-top: 0.5mm; }
.lista { margin: 0 0 5mm; padding-left: 6mm; }
.lista li { margin-bottom: 2.5mm; }
.dica { background: #fff6e5; border-left: 5px solid #f0a500; border-radius: 3mm; padding: 3.5mm 4.5mm; font-size: 13pt; line-height: 1.4; }
.dica b:first-child { color: #8a5a00; }
.numero-passo { font-size: 11pt; font-weight: 700; color: #e6371e; letter-spacing: .05em; text-transform: uppercase; margin-bottom: 1mm; }
/* capa */
.capa { background: #88185d; color: #fff; padding: 0; }
.capa .faixa { background: #fff; height: 52mm; display: flex; align-items: center; padding: 0 16mm; gap: 6mm; }
.capa .faixa svg { width: 30mm; height: 30mm; }
.capa .faixa .nome { font-size: 38pt; font-weight: 800; color: #88185d; }
.capa .faixa .nome span { color: #e6371e; }
.capa .faixa .sub { font-size: 12pt; color: #5b6575; letter-spacing: .1em; text-transform: uppercase; }
.capa .meio { padding: 22mm 16mm 0; }
.capa .rot { font-size: 14pt; letter-spacing: .15em; text-transform: uppercase; color: #f3c4dc; }
.capa h1 { color: #fff; font-size: 40pt; margin: 3mm 0 10mm; }
.capa .aprender { font-size: 17pt; line-height: 1.6; margin: 0; padding-left: 8mm; }
.capa .base { position: absolute; left: 16mm; right: 16mm; bottom: 16mm; font-size: 12pt; color: #f3c4dc; line-height: 1.6; border-top: 1px solid rgba(255,255,255,.3); padding-top: 5mm; }
/* antes de começar e problemas */
.cartao { border: 1.5px solid #d9dee8; border-radius: 4mm; padding: 5mm 6mm; margin-bottom: 5mm; font-size: 14pt; line-height: 1.45; }
.cartao h2 { font-size: 16pt; color: #88185d; margin: 0 0 2mm; }
.endereco { font-size: 22pt; font-weight: 800; color: #e6371e; background: #fdf1ee; border-radius: 3mm; padding: 3mm 5mm; display: inline-block; margin: 2mm 0; }
.problema { display: grid; grid-template-columns: 1fr; gap: 1mm; border-left: 5px solid #88185d; padding: 2.5mm 5mm; margin-bottom: 4mm; background: #faf5f8; border-radius: 0 3mm 3mm 0; }
.problema .p { font-weight: 700; font-size: 13.5pt; color: #88185d; }
.problema .r { font-size: 12.5pt; line-height: 1.4; }
.comp img { width: 100%; height: 100mm; object-fit: cover; object-position: top; border: 1.5px solid #d9dee8; border-radius: 3mm; margin-bottom: 5mm; }
.duas-img { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; align-items: start; }
.duas-img img { width: 100%; border: 1.5px solid #d9dee8; border-radius: 5mm; }
`;

// Caminho relativo ao HTML (html/ -> ../img/): a pasta continua funcionando se for copiada.
const img = (nome) => `../img/${nome}.png`;

function topo(guia) {
  return `<div class="topo"><div class="marca">${LOGO}<span>${guia === VISAO ? 'Sisto' : 'Guia do Sisto'} · ${guia.titulo}</span></div><span>${ENDERECO.replace('https://', '')}</span></div>`;
}
function rodape(guia, n, total) {
  return `<div class="rodape"><span>EE José Carlos Nogueira Reverendo – Professor</span><span>Página ${n} de ${total}</span></div>`;
}

function paginaPasso(guia, passo, nPasso, totalPassos) {
  const itens = passo.itens.map((t, i) => `<li><span class="num">${i + 1}</span><span>${t}</span></li>`).join('');
  return `
    ${topo(guia)}
    ${passo.secao ? `<div class="secao">${passo.secao}</div>` : ''}
    <div class="numero-passo">Passo ${nPasso} de ${totalPassos}</div>
    <h1>${passo.titulo}</h1>
    <div class="passo">
      <img src="${img(passo.img)}" alt="">
      <div class="texto">
        ${passo.intro ? `<p class="intro">${passo.intro}</p>` : ''}
        ${itens ? `<ul class="itens">${itens}</ul>` : ''}
        ${passo.lista ? `<ul class="lista">${passo.lista.map((t) => `<li>${t}</li>`).join('')}</ul>` : ''}
        ${passo.dica ? `<div class="dica"><b>Dica:</b> ${passo.dica}</div>` : ''}
      </div>
    </div>`;
}

// Página só de texto, em cartões (Issue #162: orientações de tutoria da PEI),
// para não precisar de print novo nem mudar a numeração dos prints existentes.
function paginaCartoes(guia, passo, nPasso, totalPassos) {
  return `
    ${topo(guia)}
    <div class="numero-passo">Passo ${nPasso} de ${totalPassos}</div>
    <h1>${passo.titulo}</h1>
    ${passo.cartoes.map(([titulo, texto]) => `<div class="cartao"><h2>${titulo}</h2>${texto}</div>`).join('')}`;
}

function gerarHtml(guia) {
  const paginas = [];
  // Capa
  paginas.push(`<section class="pagina capa">
    <div class="faixa">${LOGO}<div><div class="nome">Sisto<span>.</span></div><div class="sub">Gestão de ocorrências escolares</div></div></div>
    <div class="meio">
      <div class="rot">Guia de uso</div>
      <h1>${guia.titulo}</h1>
      <p style="font-size:16pt;margin:0 0 4mm;color:#f3dce9">Neste guia você vai aprender a:</p>
      <ul class="aprender">${guia.resumo.map((r) => `<li>${r}</li>`).join('')}</ul>
    </div>
    <div class="base">EE José Carlos Nogueira Reverendo – Professor<br>As imagens deste guia usam somente dados de exemplo (nomes fictícios).</div>
  </section>`);
  // Antes de começar
  paginas.push(`<section class="pagina">${topo(guia)}
    <h1>Antes de começar</h1>
    <div class="cartao"><h2>Onde abrir o Sisto</h2>
      No celular ou no computador, abra o navegador (Chrome, por exemplo) e digite:<br>
      <span class="endereco">${ENDERECO.replace('https://', '')}</span><br>
      Não precisa instalar nenhum aplicativo.</div>
    <div class="cartao"><h2>Do que você precisa</h2>
      O seu <b>e-mail</b> e uma <b>senha</b>. Quem cadastra e entrega a primeira senha é a <b>Gestão</b> da escola.</div>
    <div class="cartao"><h2>Como ler este guia</h2>
      Cada página mostra <b>um passo</b>. Os <span class="num" style="display:inline-flex;vertical-align:middle">1</span> números vermelhos na imagem mostram <b>onde tocar</b>, na mesma ordem do texto ao lado.</div>
    <div class="cartao"><h2>Sobre as imagens</h2>
      Algumas imagens mostram outro perfil no alto da tela (por exemplo, "Professor Exemplo"). Os botões e os campos são os mesmos para você.</div>
    <div class="cartao"><h2>Cuidado com os dados</h2>
      As ocorrências têm informações de estudantes menores de idade. Não mostre a tela a outras pessoas, não compartilhe a sua senha e <b>saia do Sisto</b> quando terminar.</div>
  </section>`);
  // Passos
  guia.passos.forEach((chave, i) => {
    const passo = P[chave];
    paginas.push(`<section class="pagina">${passo.cartoes ? paginaCartoes(guia, passo, i + 1, guia.passos.length) : paginaPasso(guia, passo, i + 1, guia.passos.length)}</section>`);
  });
  // No computador
  const [c1, c2] = COMPUTADOR[guia.id];
  paginas.push(`<section class="pagina comp">${topo(guia)}
    <h1>No computador</h1>
    <p class="texto" style="margin:0 0 5mm">No computador, o Sisto é o <b>mesmo</b>: os botões e os campos têm os mesmos nomes. Só a tela é mais larga, e o menu fica todo em uma linha.</p>
    <img src="${img(c1)}" alt=""><img src="${img(c2)}" alt="">
  </section>`);
  // Problemas
  const problemas = PROBLEMAS_COMUNS.filter((p) => !p[3] || p[3].includes(guia.id));
  const comImagem = problemas.filter((p) => p[2]);
  paginas.push(`<section class="pagina">${topo(guia)}
    <h1>Deu algum problema?</h1>
    ${problemas.map(([p, r]) => `<div class="problema"><div class="p">${p}</div><div class="r">${typeof r === 'string' ? r : r[guia.id] ?? r.padrao}</div></div>`).join('')}
  </section>`);
  paginas.push(`<section class="pagina">${topo(guia)}
    <h1>Deu algum problema? (imagens)</h1>
    <div class="duas-img">${comImagem.map((p) => `<div><p class="texto" style="font-size:13pt;margin:0 0 3mm"><b>${p[0]}</b></p><img src="${img(p[2])}" alt=""></div>`).join('')}</div>
    <div class="cartao" style="margin-top:6mm"><h2>Ainda com dúvida?</h2>Procure a <b>Gestão</b> ou a <b>Equipe Pedagógica</b> da escola.</div>
  </section>`);

  const total = paginas.length;
  const corpo = paginas.map((p, i) => (i === 0 ? p : p.replace('</section>', `${rodape(guia, i + 1, total)}</section>`))).join('\n');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Guia do Sisto — ${guia.titulo}</title><style>${CSS}</style></head><body>${corpo}</body></html>`;
}

// ---------------------------------------------------------------------------
// Visão geral da plataforma (Issue #146): o que o Sisto faz, para qualquer
// pessoa da escola. Usa só os prints de computador (sem os números dos guias).
// ---------------------------------------------------------------------------
const VISAO = { titulo: 'Visão geral', arquivo: 'Sisto-Visao-Geral' };
// Estilos só da visão geral (os guias da #142 continuam com o CSS comum).
const CSS_VISAO = `
.vg { font-size: 13pt; line-height: 1.45; }
.vg p { margin: 0 0 3.5mm; }
.vg .cartao { font-size: 13pt; padding: 4mm 5mm; margin-bottom: 4mm; }
.vg .cartao h2 { font-size: 14.5pt; }
.vg .cartao ul { margin: 1mm 0 0; padding-left: 6mm; }
.vg .cartao li { margin-bottom: 1mm; }
.figura { width: 100%; height: 88mm; object-fit: cover; object-position: top; border: 1.5px solid #d9dee8; border-radius: 3mm; margin: 1mm 0 4mm; }
.figura.baixa { height: 72mm; }
.legenda { font-size: 10.5pt; color: #5b6575; margin: -2.5mm 0 4mm; }
.colunas { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
.perfil { border: 1.5px solid #d9dee8; border-left: 6px solid #88185d; border-radius: 3mm; padding: 3mm 5mm; margin-bottom: 3mm; }
.perfil h2 { font-size: 15pt; color: #88185d; margin: 0 0 1mm; }
.perfil p { margin: 0; }
.matriz { width: 100%; border-collapse: collapse; font-size: 11.5pt; }
.matriz th, .matriz td { border: 1px solid #d9dee8; padding: 2.2mm 2mm; text-align: center; }
.matriz th { background: #88185d; color: #fff; font-size: 10.5pt; }
.matriz td:first-child, .matriz th:first-child { text-align: left; }
.matriz tr:nth-child(even) td { background: #faf5f8; }
.matriz .sim { color: #1e7a3c; font-weight: 800; }
.matriz .nao { color: #9aa3b2; }
.matriz .obs { font-size: 9.5pt; color: #5b6575; display: block; }
/* Seis perfis (Issue #155): colunas fixas e texto menor para a tabela caber na página. */
.matriz.seis { table-layout: fixed; font-size: 10.5pt; }
.matriz.seis th { font-size: 9.5pt; padding: 2mm 1mm; }
.matriz.seis td { padding: 1.8mm 1.2mm; }
.matriz.seis th:first-child, .matriz.seis td:first-child { width: 34%; }
.matriz.seis .obs { font-size: 8.5pt; line-height: 1.2; }
.nota { font-size: 10.5pt; color: #5b6575; margin-top: 3mm; line-height: 1.4; }
.fluxo { display: grid; grid-template-columns: 1fr 9mm 1fr 9mm 1fr; align-items: stretch; margin: 2mm 0 5mm; }
.etapa { border-radius: 4mm; padding: 4mm; color: #1b2433; border: 2px solid; }
.etapa .st { font-weight: 800; font-size: 13pt; margin-bottom: 1.5mm; }
.etapa .qm { font-size: 11pt; line-height: 1.35; }
.etapa.aberto { background: #eef4ff; border-color: #3b6fd8; }
.etapa.aberto .st { color: #2453b3; }
.etapa.acomp { background: #fff6e5; border-color: #f0a500; }
.etapa.acomp .st { color: #8a5a00; }
.etapa.encerrado { background: #edf7f0; border-color: #2e9b53; }
.etapa.encerrado .st { color: #1e7a3c; }
.seta { display: flex; align-items: center; justify-content: center; color: #88185d; font-size: 20pt; font-weight: 800; }
.regras { margin: 0; padding-left: 6mm; }
.regras li { margin-bottom: 2mm; }
`;
const S = '<span class="sim">✔</span>';
const N = '<span class="nao">—</span>';

function gerarVisaoGeral() {
  const t = topo(VISAO);
  const paginas = [];
  paginas.push(`<section class="pagina capa">
    <div class="faixa">${LOGO}<div><div class="nome">Sisto<span>.</span></div><div class="sub">Gestão de ocorrências escolares</div></div></div>
    <div class="meio">
      <div class="rot">Visão geral da plataforma</div>
      <h1>Conheça o Sisto</h1>
      <p style="font-size:16pt;margin:0 0 4mm;color:#f3dce9">Neste material você vai conhecer:</p>
      <ul class="aprender"><li>O que é o Sisto e para que ele serve</li><li>Quem usa e o que cada perfil pode fazer</li><li>O caminho de uma ocorrência, do registro ao encerramento</li><li>Tudo o que a plataforma faz e como ela protege os dados</li></ul>
    </div>
    <div class="base">EE José Carlos Nogueira Reverendo – Professor<br>As imagens deste material usam somente dados de exemplo (nomes fictícios).</div>
  </section>`);

  paginas.push(`<section class="pagina vg">${t}
    <h1>O que é o Sisto</h1>
    <p>O Sisto é o sistema da escola para <b>registrar, encaminhar, acompanhar e consultar as ocorrências escolares</b>: indisciplina, conflitos, bullying, situações de sofrimento emocional e outras.</p>
    <div class="cartao"><h2>Como era antes</h2>
      As ocorrências eram anotadas em <b>formulários de papel</b>. Depois, a equipe pedagógica organizava tudo e passava as informações para a Plataforma Conviva. Isso gastava papel e tempo, e os registros podiam se perder ou ser difíceis de encontrar depois.</div>
    <div class="cartao"><h2>O que muda com o Sisto</h2>
      <ul>
        <li>A ocorrência é registrada <b>no celular ou no computador</b>, na hora.</li>
        <li>Ela já sai <b>encaminhada</b> para quem vai cuidar do caso.</li>
        <li>Tudo o que acontece depois fica no <b>histórico</b>: quem fez, o quê e quando.</li>
        <li>Fica fácil <b>procurar</b> registros antigos e ver <b>relatórios</b> por período, turma e categoria.</li>
      </ul></div>
    <img class="figura baixa" src="${img('prof-16-computador-lista')}" alt="">
    <p class="legenda">A lista de ocorrências no computador.</p>
  </section>`);

  paginas.push(`<section class="pagina vg">${t}
    <h1>Como acessar</h1>
    <div class="cartao"><h2>Onde abrir</h2>
      No celular, no tablet ou no computador, abra o navegador (Chrome, por exemplo) e digite:<br>
      <span class="endereco">${ENDERECO.replace('https://', '')}</span><br>
      Não precisa instalar nenhum aplicativo.</div>
    <div class="cartao"><h2>Quem pode entrar</h2>
      Só quem foi <b>cadastrado pela Gestão</b> da escola. Cada pessoa entra com o <b>próprio e-mail e a própria senha</b>, e vê apenas o que é da sua função.</div>
    <div class="cartao"><h2>Primeiro acesso</h2>
      A Gestão entrega uma <b>senha temporária</b>. No primeiro acesso, o Sisto pede para criar uma senha nova, só sua, com pelo menos 8 caracteres. Assim, nem a Gestão fica sabendo a sua senha.</div>
    <div class="cartao"><h2>Durante o uso</h2>
      <ul>
        <li>Por segurança, a entrada vale por até <b>8 horas</b>. Depois disso, é preciso entrar de novo.</li>
        <li>Ao terminar, toque em <b>Sair</b>, principalmente em aparelhos compartilhados.</li>
        <li>Fora do horário da escola (antes das 7h, depois das 20h e nos fins de semana), a primeira abertura pode demorar cerca de 1 minuto.</li>
      </ul></div>
  </section>`);

  const perfis = [
    ['Professor', 'Registra as ocorrências que observa em sala de aula ou na escola e consulta as que registrou.'],
    ['Técnico-administrativo', 'Igual ao Professor: registra ocorrências e consulta as que registrou.'],
    ['Tutor', 'Na PEI, todo professor é tutor, e cada aluno é ligado ao tutor que escolheu. Registra ocorrências e acompanha as dos seus tutorados, as que recebe e as que acompanha como responsável. Registra comunicações com a família e, quando é o responsável pelo acompanhamento, registra providências e encerra a ocorrência.'],
    ['Psicólogo escolar', 'Registra ocorrências e recebe as encaminhadas a ele, com a justificativa de quem pediu o acolhimento do estudante. Registra comunicações, mas não encaminha, não registra providências e não encerra.'],
    ['Equipe Pedagógica <span style="font-weight:400;font-size:11pt;color:#5b6575">(na tela, perfil "Pedagógico")</span>', 'Vê todas as ocorrências da escola, encaminha e define quem acompanha cada caso, registra comunicações e providências, encerra ocorrências, gera relatórios e cuida das categorias.'],
    ['Gestão', 'Faz tudo o que a Equipe Pedagógica faz e, além disso, cadastra usuários, turmas e estudantes, liga cada estudante ao seu tutor, redefine senhas e bloqueia ou desativa o acesso de quem sai da escola.'],
  ];
  paginas.push(`<section class="pagina vg">${t}
    <h1>Quem usa o Sisto</h1>
    <p>Cada pessoa tem um <b>perfil</b>, definido pela Gestão no cadastro. O perfil decide o que a pessoa vê e o que pode fazer.</p>
    ${perfis.map(([n, d]) => `<div class="perfil"><h2>${n}</h2><p>${d}</p></div>`).join('')}
  </section>`);

  const seFez = `${S}<span class="obs">se fez o encaminha&shy;mento</span>`;
  const linhas = [
    ['Registrar ocorrência', S, S, S, S, S, S],
    ['Ver as ocorrências que registrou', S, S, S, S, S, S],
    ['Ver as ocorrências dos seus tutorados', N, N, S, N, S, S],
    ['Ver as ocorrências encaminhadas a você ou que você acompanha', N, N, S, S, S, S],
    ['Ver todas as ocorrências da escola', N, N, N, N, S, S],
    ['Encaminhar ocorrência e definir quem acompanha', N, N, N, N, S, S],
    ['Ler a justificativa do encaminhamento ao psicólogo escolar', seFez, seFez, seFez, `${S}<span class="obs">se for o destinatário</span>`, seFez, S],
    ['Registrar comunicação', N, N, `${S}<span class="obs">nas que vê</span>`, `${S}<span class="obs">nas que vê</span>`, S, S],
    ['Registrar providência e encerrar', N, N, `${S}<span class="obs">se for o responsável</span>`, N, S, S],
    ['Ver relatórios', N, N, N, N, S, S],
    ['Cadastrar e editar categorias', N, N, N, N, S, S],
    ['Cadastrar usuários, turmas e estudantes', N, N, N, N, N, S],
    ['Redefinir a senha de outra pessoa', N, N, N, N, N, S],
    ['Trocar a própria senha', S, S, S, S, S, S],
  ];
  paginas.push(`<section class="pagina vg">${t}
    <h1>Quem pode fazer o quê</h1>
    <table class="matriz seis">
      <thead><tr><th>O que fazer</th><th>Professor</th><th>Técnico-adm.</th><th>Tutor</th><th>Psicólogo escolar</th><th>Equipe Pedagógica</th><th>Gestão</th></tr></thead>
      <tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    <p class="nota">✔ pode fazer · — não pode fazer.<br>
    Professor e Técnico-administrativo não recebem encaminhamentos: a ocorrência é sempre encaminhada a um tutor, ao psicólogo escolar, à Equipe Pedagógica ou à Gestão.<br>
    Se a escola precisar de outra divisão, fale com a Gestão.</p>
  </section>`);

  paginas.push(`<section class="pagina vg">${t}
    <h1>O caminho de uma ocorrência</h1>
    <p>Toda ocorrência passa por <b>três situações</b> (status), sempre nesta ordem:</p>
    <div class="fluxo">
      <div class="etapa aberto"><div class="st">Aberto</div><div class="qm">Qualquer perfil registra a ocorrência e escolhe para quem ela vai: um tutor, o psicólogo escolar, a Equipe Pedagógica ou a Gestão.</div></div>
      <div class="seta">→</div>
      <div class="etapa acomp"><div class="st">Em acompanhamento</div><div class="qm">A Equipe Pedagógica ou a Gestão encaminha e define o <b>responsável pelo acompanhamento</b>. Nessa fase, a escola registra os contatos com a família e as providências tomadas.</div></div>
      <div class="seta">→</div>
      <div class="etapa encerrado"><div class="st">Encerrado</div><div class="qm">O responsável, a Equipe Pedagógica ou a Gestão encerra o caso. A ocorrência fica guardada para consulta.</div></div>
    </div>
    <div class="cartao"><h2>Regras do caminho</h2>
      <ul class="regras">
        <li>Uma ocorrência só é registrada se for <b>encaminhada</b> para alguém.</li>
        <li>O status não volta atrás e não pula etapas. Uma ocorrência encerrada <b>não é reaberta</b>.</li>
        <li>Para encerrar, é preciso ter registrado pelo menos <b>uma providência</b>.</li>
        <li>Uma ocorrência registrada <b>não pode ser editada nem apagada</b>. Tudo o que acontece depois é acrescentado a ela.</li>
        <li>Cada passo fica no <b>histórico</b>, com quem fez e quando.</li>
      </ul></div>
  </section>`);

  paginas.push(`<section class="pagina vg">${t}
    <h1>Registrar uma ocorrência</h1>
    <p>Todos os perfis registram ocorrências. Quem registra fica gravado como o <b>profissional responsável</b> pelo registro.</p>
    <div class="colunas">
      <div class="cartao"><h2>O que se informa</h2>
        <ul><li>Turma e estudante(s) envolvido(s): pode ser mais de um, até de turmas diferentes.</li><li>Categoria e descrição do fato.</li><li>Data, hora e local.</li><li>Opcionais: demais envolvidos, testemunhas, providências imediatas e observações.</li><li>Para quem a ocorrência vai. No encaminhamento ao psicólogo escolar, também a <b>justificativa</b>.</li></ul></div>
      <div class="cartao"><h2>Cuidados</h2>
        <ul><li>A data e a hora do fato não podem estar no futuro.</li><li>Escreva de forma <b>objetiva</b>, contando o que aconteceu, sem rótulos ou palavras que ofendam o estudante.</li><li>Confira tudo antes de enviar: depois de registrada, a ocorrência não pode ser editada.</li></ul></div>
    </div>
    <img class="figura" src="${img('prof-17-computador-registrar')}" alt="">
    <p class="legenda">A tela de registro no computador.</p>
  </section>`);

  paginas.push(`<section class="pagina vg">${t}
    <h1>Acompanhar uma ocorrência</h1>
    <div class="cartao"><h2>Encaminhar</h2>
      A Equipe Pedagógica e a Gestão encaminham a ocorrência para um tutor, para o psicólogo escolar, para a Equipe Pedagógica ou para a Gestão, e escolhem o <b>responsável pelo acompanhamento</b> (que não pode ser o psicólogo escolar). A ocorrência passa para "Em acompanhamento". Enquanto não estiver encerrada, ela pode ser encaminhada de novo, e o responsável pode ser trocado.</div>
    <div class="cartao"><h2>Comunicação</h2>
      Registra um contato que a escola fez <b>fora do sistema</b>, por exemplo, um telefonema para a família ou um contato com a rede de proteção. O Sisto <b>não envia</b> mensagens: ele guarda quem foi avisado, por qual meio e quando.</div>
    <div class="cartao"><h2>Providência e encerramento</h2>
      A providência é o que a escola fez para resolver o caso. Com pelo menos uma providência registrada, o responsável, a Equipe Pedagógica ou a Gestão podem encerrar a ocorrência.</div>
    <img class="figura baixa" src="${img('tutor-09-computador-detalhe')}" alt="">
    <p class="legenda">O detalhe de uma ocorrência no computador.</p>
  </section>`);

  paginas.push(`<section class="pagina vg">${t}
    <h1>Consultar e ver o histórico</h1>
    <p>Em <b>Ocorrências</b>, cada pessoa vê a lista das ocorrências que o seu perfil permite, da mais recente para a mais antiga, 20 por página.</p>
    <div class="cartao"><h2>Filtros</h2>
      Para encontrar um registro, é possível filtrar por <b>turma</b>, <b>categoria</b>, <b>status</b>, <b>estudante</b> e <b>período</b>. A Gestão também filtra pelo <b>profissional que registrou</b>.</div>
    <div class="cartao"><h2>Detalhe e histórico</h2>
      Ao abrir uma ocorrência, aparecem todos os dados do registro, os encaminhamentos, as comunicações, as providências e o <b>histórico</b>: a lista de tudo o que foi feito, com quem fez e quando.</div>
    <img class="figura" src="${img('ped-10-computador-lista')}" alt="">
    <p class="legenda">A lista com os filtros, no computador.</p>
  </section>`);

  paginas.push(`<section class="pagina vg">${t}
    <h1>Relatórios e categorias</h1>
    <div class="cartao"><h2>Relatórios</h2>
      A Equipe Pedagógica e a Gestão veem a <b>quantidade de ocorrências</b> de um período, no total ou separada por <b>turma</b> ou por <b>categoria</b>. O relatório aparece na tela e pode ser impresso pelo botão <b>Imprimir</b>. Na janela de impressão do navegador, também dá para escolher "Salvar como PDF".</div>
    <div class="cartao"><h2>Categorias</h2>
      As categorias são os tipos de ocorrência (por exemplo, Indisciplina, Conflitos, Bullying). A Equipe Pedagógica e a Gestão podem cadastrar categorias novas e corrigir os nomes. Categorias não são apagadas, para não perder o que já foi registrado.</div>
    <img class="figura" src="${img('ped-09-computador-relatorio')}" alt="">
    <p class="legenda">Um relatório no computador.</p>
  </section>`);

  paginas.push(`<section class="pagina vg">${t}
    <h1>Cadastros da Gestão</h1>
    <div class="cartao"><h2>Usuários</h2>
      <ul><li>Cadastrar as pessoas da escola, com nome, e-mail, perfil e senha temporária.</li><li><b>Redefinir a senha</b> de quem esqueceu.</li><li><b>Bloquear</b> ou <b>desativar</b> o acesso de quem saiu da escola, e <b>reativar</b> quando precisar. Ninguém é apagado: os registros da pessoa continuam guardados.</li><li>O Sisto mantém sempre <b>pelo menos duas pessoas da Gestão ativas</b>, para uma poder ajudar a outra: ele não deixa bloquear, desativar ou mudar o perfil de alguém da Gestão se sobrarem menos de duas.</li></ul></div>
    <div class="colunas">
      <div class="cartao"><h2>Turmas</h2>Nome, etapa e ano letivo. Cada ano letivo tem as suas turmas.</div>
      <div class="cartao"><h2>Estudantes</h2>Nome, turma, código escolar (opcional) e <b>professor tutor</b> (pode ser ligado depois).</div>
    </div>
    <img class="figura baixa" src="${img('gestao-09-computador-usuarios')}" alt="">
    <p class="legenda">A tela de usuários no computador.</p>
  </section>`);

  paginas.push(`<section class="pagina vg">${t}
    <h1>Segurança e proteção dos dados</h1>
    <p>As ocorrências têm informações de <b>estudantes menores de idade</b>. Por isso, o Sisto segue a Lei Geral de Proteção de Dados (LGPD):</p>
    <div class="cartao"><h2>Cada um vê só o necessário</h2>Professor e Técnico-administrativo veem as ocorrências que registraram; o Tutor, também as dos seus tutorados, as que recebe e as que acompanha como responsável; o Psicólogo escolar, as que registrou e as encaminhadas a ele; só a Equipe Pedagógica e a Gestão veem todas. A <b>justificativa</b> do encaminhamento ao psicólogo escolar só aparece para o psicólogo que recebeu, para a Gestão e para quem fez o encaminhamento; as demais pessoas veem um aviso no lugar do texto.</div>
    <div class="cartao"><h2>Senhas protegidas</h2>A senha é pessoal e fica guardada de forma embaralhada: ninguém consegue lê-la, nem a Gestão. Depois de 5 senhas erradas, o Sisto pede para esperar alguns minutos (até 15) antes de tentar de novo. A conta não fica bloqueada.</div>
    <div class="cartao"><h2>Tudo fica registrado</h2>O Sisto guarda quem fez cada registro ou alteração e quando. Uma ocorrência não é editada nem apagada.</div>
    <div class="cartao"><h2>Acesso cortado na hora</h2>Quando a Gestão bloqueia ou desativa uma pessoa, ela perde o acesso imediatamente, mesmo que esteja com o Sisto aberto.</div>
    <div class="cartao"><h2>A sua parte</h2>Não compartilhe a sua senha, não mostre a tela a outras pessoas e saia do Sisto ao terminar.</div>
  </section>`);

  paginas.push(`<section class="pagina vg">${t}
    <h1>O que o Sisto não faz</h1>
    <p>Para evitar dúvidas, esta versão do Sisto <b>não</b>:</p>
    <div class="cartao"><ul class="regras">
      <li>tem aplicativo para instalar: ele funciona pelo navegador;</li>
      <li>envia mensagens, SMS ou e-mails para as famílias (a comunicação é feita pela escola e só registrada no Sisto);</li>
      <li>envia dados para a Plataforma Conviva ou para outros sistemas da Secretaria da Educação;</li>
      <li>importa turmas e estudantes de outros sistemas (o cadastro é feito pela Gestão);</li>
      <li>exporta relatórios em PDF ou planilha (eles podem ser impressos pelo navegador);</li>
      <li>tem painel de gráficos, assinatura eletrônica, módulo de mediação de conflitos ou banco de orientações e procedimentos da escola;</li>
      <li>tem "esqueci minha senha" por e-mail: quem esqueceu pede à Gestão para redefinir;</li>
      <li>permite editar ou apagar uma ocorrência registrada.</li>
    </ul></div>
    <h1 style="margin-top:8mm">Onde buscar ajuda</h1>
    <div class="cartao"><h2>Guias de uso, passo a passo</h2>
      Há um guia com imagens para cada perfil: <b>Professor e Técnico-administrativo</b>, <b>Tutor</b>, <b>Psicólogo escolar</b>, <b>Equipe Pedagógica</b> e <b>Gestão</b>.</div>
    <div class="cartao"><h2>Ainda com dúvida?</h2>Procure a <b>Gestão</b> ou a <b>Equipe Pedagógica</b> da escola.</div>
  </section>`);

  const total = paginas.length;
  const corpo = paginas.map((pg, i) => (i === 0 ? pg : pg.replace(/<\/section>$/, `${rodape(VISAO, i + 1, total)}</section>`))).join('\n');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Sisto — ${VISAO.titulo}</title><style>${CSS}${CSS_VISAO}</style></head><body>${corpo}</body></html>`;
}

function acharChrome() {
  const caminhos = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return caminhos.find((c) => existsSync(c));
}

mkdirSync(SAIDA_HTML, { recursive: true });
const chrome = acharChrome();
const documentos = [...GUIAS.map((guia) => [guia.arquivo, gerarHtml(guia)]), [VISAO.arquivo, gerarVisaoGeral()]];
for (const [arquivo, html] of documentos) {
  const arquivoHtml = join(SAIDA_HTML, `${arquivo}.html`);
  writeFileSync(arquivoHtml, html, 'utf8');
  if (chrome) {
    const pdf = join(SAIDA_PDF, `${arquivo}.pdf`);
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files', `--user-data-dir=${join(tmpdir(), 'sisto-guias-chrome')}`, `--print-to-pdf=${pdf}`, pathToFileURL(arquivoHtml).href], { stdio: 'ignore' });
    console.log(`PDF: ${pdf}`);
  } else {
    console.log(`HTML: ${arquivoHtml} (Chrome não encontrado: abra e imprima em PDF)`);
  }
}
