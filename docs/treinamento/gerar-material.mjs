// Gera o material de treinamento do Sisto (Issue #142): 4 guias em HTML e PDF,
// um por perfil, com os prints de docs/treinamento/img (dados fictícios — RN05).
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
    itens: ['Em <b>Encaminhar para</b>, escolha <b>Tutor</b>, <b>Equipe pedagógica</b> ou <b>Gestão</b>.', 'Se escolheu <b>Tutor</b>, escolha qual tutor vai receber.'],
    dica: 'Para encaminhar a mais de uma pessoa, toque em "Adicionar destinatário".',
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
    itens: ['Em <b>Encaminhar para</b>, escolha Tutor, Equipe pedagógica ou Gestão. Se for Tutor, escolha qual tutor; se for uma equipe, pode deixar "Toda a equipe".', 'Escolha o <b>Responsável pelo acompanhamento</b>: quem vai cuidar do caso.', 'Se quiser, escreva uma <b>Observação</b>.'],
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
    itens: ['<b>Nome completo</b> da pessoa.', '<b>E-mail</b>: será usado para entrar no Sisto.', '<b>Perfil</b>: Professor, Tutor, Gestão, Pedagógico ou Técnico-administrativo.', '<b>Senha temporária</b>: a pessoa troca no primeiro acesso.'],
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
  ['Apertei sem querer para fechar uma janela com texto.', 'O Sisto pergunta antes de descartar. Toque em <b>Continuar editando</b> (1) para voltar ao texto, ou em <b>Descartar</b> (2) se quiser apagar.', 'comum-descartar-texto', ['tutor', 'pedagogico', 'gestao']],
  ['Registrei uma ocorrência com um erro.', 'Ninguém pode editar uma ocorrência depois de registrada. Avise a <b>Equipe Pedagógica</b> ou a <b>Gestão</b>, que vão orientar o que fazer.', null, ['professor', 'tutor']],
];

const GUIAS = [
  {
    id: 'professor',
    arquivo: 'Guia-Sisto-Professor-e-Tecnico-administrativo',
    titulo: 'Professor e Técnico-administrativo',
    resumo: ['Entrar e criar a sua senha', 'Registrar uma ocorrência, passo a passo', 'Ver as ocorrências que você registrou', 'Trocar a sua senha e sair'],
    passos: ['entrar', 'primeiroAcesso', 'inicioProfessor', 'reg1', 'reg2', 'reg3', 'reg4', 'reg5', 'reg6', 'registrada', 'lista', 'detalhe', 'historico', 'alterarSenha', 'sair'],
  },
  {
    id: 'tutor',
    arquivo: 'Guia-Sisto-Tutor',
    titulo: 'Tutor',
    resumo: ['Entrar e registrar ocorrências', 'Acompanhar as ocorrências dos seus tutorados', 'Registrar comunicações e providências', 'Encerrar uma ocorrência'],
    passos: ['entrar', 'primeiroAcesso', 'inicioTutor', 'reg1', 'reg2', 'reg3', 'reg4', 'reg5', 'reg6', 'registrada', 'tutorLista', 'filtros', 'detalhe', 'tutorAcoes', 'comunicacao', 'comunicacao2', 'providencia', 'encerrar', 'encerrada', 'historico', 'alterarSenha', 'sair'],
  },
  {
    id: 'pedagogico',
    arquivo: 'Guia-Sisto-Equipe-Pedagogica',
    titulo: 'Equipe Pedagógica',
    resumo: ['Ver e procurar todas as ocorrências', 'Encaminhar e definir quem acompanha', 'Comunicações, providências e encerramento', 'Relatórios e categorias'],
    passos: ['entrar', 'primeiroAcesso', 'inicioPedagogico', 'reg1', 'reg2', 'reg3', 'reg4', 'reg5', 'reg6', 'registrada', 'lista', 'filtros', 'detalhe', 'encaminharAcoes', 'encaminhar', 'encaminhar2', 'emAcompanhamento', 'comunicacao', 'comunicacao2', 'providencia', 'encerrar', 'encerrada', 'historico', 'relatorio', 'relatorio2', 'categorias', 'alterarSenha', 'sair'],
  },
  {
    id: 'gestao',
    arquivo: 'Guia-Sisto-Gestao',
    titulo: 'Gestão',
    resumo: ['Tudo o que a Equipe Pedagógica faz', 'Cadastrar usuários, bloquear e redefinir senhas', 'Cadastrar turmas e estudantes (com o tutor)', 'Relatórios e categorias'],
    passos: ['entrar', 'primeiroAcesso', 'inicioGestao', 'usuario', 'usuario2', 'usuarioAcoes', 'redefinir', 'bloquear', 'turma', 'estudante', 'reg1', 'reg2', 'reg3', 'reg4', 'reg5', 'reg6', 'registrada', 'lista', 'filtros', 'detalhe', 'encaminharAcoes', 'encaminhar', 'encaminhar2', 'emAcompanhamento', 'comunicacao', 'comunicacao2', 'providencia', 'encerrar', 'encerrada', 'historico', 'relatorio', 'relatorio2', 'categorias', 'alterarSenha', 'sair'],
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
  return `<div class="topo"><div class="marca">${LOGO}<span>Guia do Sisto · ${guia.titulo}</span></div><span>${ENDERECO.replace('https://', '')}</span></div>`;
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
    paginas.push(`<section class="pagina">${paginaPasso(guia, P[chave], i + 1, guia.passos.length)}</section>`);
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
for (const guia of GUIAS) {
  const arquivoHtml = join(SAIDA_HTML, `${guia.arquivo}.html`);
  writeFileSync(arquivoHtml, gerarHtml(guia), 'utf8');
  if (chrome) {
    const pdf = join(SAIDA_PDF, `${guia.arquivo}.pdf`);
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--allow-file-access-from-files', `--user-data-dir=${join(tmpdir(), 'sisto-guias-chrome')}`, `--print-to-pdf=${pdf}`, pathToFileURL(arquivoHtml).href], { stdio: 'ignore' });
    console.log(`PDF: ${pdf}`);
  } else {
    console.log(`HTML: ${arquivoHtml} (Chrome não encontrado: abra e imprima em PDF)`);
  }
}
