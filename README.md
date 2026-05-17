# FabricWebAuth - Interface Web Segura para Redes Fabric

Este repositório é um protótipo baseado na distribuição de demonstração do hyperledger fabric cc-tools. Essa distribuição do fabric é a mesma usada pela RNP, com alguns scripts de configuração a menos, mas a funcionalidade é essencialmente a mesma. Este repositório contém o chaincode protótipo para armazenamento e busca dos dados dos testes de cassetes. Também possui uma API de busca inicial, sem uma definição pronta no momento. 

## Instalação de Dependências

Para instalar todas as dependências, basta executar o arquivo `./install.sh`, na pasta raiz. Isso vai automaticamente instalar todos os pacotes necessários e o gerenciador `fabricManager`. Caso algum deles dê erro, as dependências estão listadas abaixo:

- Go versão 1.21 ou superior
- Docker versão 20.10.5 ou superior
- Docker Compose versão 1.28.5 ou superior
- Node.js versão v22.19.0 ou superior
- npm versão 11.6.2 ou superior

## Gerenciamento da rede

Todo o gerenciamento da rede base foi simplificado por meio do script `fabricManager`. Após a instalação dos requisitos, basta usar o comando com algum parâmetro para poder levantar, derrubar ou reiniciar a rede, incluindo processos limpos que irão reescrever os certificados da rede. Esses são os comandos disponíveis:
```bash
FabricWebAuth manager

Uso:
  fabricManager <comando>

Comandos:

  upclean
      Levanta a rede do zero

  downclean
      Derruba a rede e remove certificados

  restartclean
      Reinício completo da rede

  up
      Levanta rede previamente criada

  down
      Derruba rede mantendo certificados

  restart
      Reinício leve da rede

  installcc <nome_chaincode> <path_chaincode>
      Instala um novo chaincode

  upgradecc <nome_chaincode> <path_chaincode> <versao> <sequencia>
      Atualiza um chaincode existente

  help
      Exibe menu de ajuda
```

> [!WARN]
> Derrubar ou reiniciar a rede de forma limpa irá apagar todos os certificados da rede, use com cautela! 
> Isso revogará a autenticação de todos os usuários. Além disso, a rede só irá levantar corretamente caso use o script de levantamento completo `upclean`.
 
## Instalação dos Chaincodes

A rede atualmente com um chaincode de testes. O chaincode possui funcionalidades básicas de escrita e query no ledger, apenas para testes básicos da rede. Qualquer chaincode CCaaS funciona na rede, porém ainda não foi implementado o uso de imagens docker diretamente de um repositório, sendo necessário ter o código local para a instalação.

Para fazer a instalação de chaincodes, basta usar o gerenciador:

```bash
fabricManager <nome_do_chaincode> <local_do_chaincode>
```

E para fazer o upgrade de um chaincode:

```bash
fabricManager <nome_do_chaincode> <local_do_chaincode> <versao> <sequencia>
```

## Execução do Chaincode de Teste
### Instalação das Dependências
Na pasta raiz da rede, há uma pasta "client". Essa pasta contém todos os itens para executar o chaincode usando um cliente `Node.js`. Para instalar as dependências, acesse a pasta client e execute `npm i`. Caso seja a primeira vez que esteja executando o cliente, é necessário executar o script `enrollAdmin.js`, localizado também na pasta cliente. Isso irá gerar o certificado X.509 da autoridade com permissão de enroll, o que permitirá registrar novos usuários.

### Executando pela Interface de Teste

A interface web agora está containerizada em Docker. Para executar, acesse a pasta client e execute o comando:
```bash
docker-compose up -d
```

Isso levantará automaticamente a interface na porta 3000, acessível em localhost:3000 ou no IP da máquina host. O container ficará rodando continuamente em background, sem necessidade de manter o terminal aberto e pode ser derrubado com o comando `docker-compose down -v`.

A interface possui funcionalidades básicas para interagir com o chaincode, permitindo que o usuário insira sua chave privada para se registrar ou se autenticar como usuário da rede. 

## Código do Chaincode

O código principal dos chaincodes estão dentro das pastas `/sollytch-chain` e `/sollytch-chain` na raiz do projeto. O código `main.go` é o código principal de ambos os chaincodes. Qualquer edição feita nele NÃO IRÁ SURTIR EFEITO IMEDIATO NA REDE. Caso alguma alteração seja feita no chaincode, será necessário fazer o upgrade do chaincode na rede. Isso pode ser feito com o comando abaixo:

```bash
./network.sh deployCCAAS -ccn sollytch-chain -ccs 2 -ccv 2.0 -ccp ../sollytch-chain/
```
> [!NOTE]
> Caso o chaincode precise de upgrade novamente, basta alterar os valores de `-ccs` e `-ccv`, além de alterar o nome do chaincode.

## Fauxton

O Fauxton é a interface web nativa do CouchDB, que atua como banco de estado no Hyperledger Fabric. Ele fornece uma forma visual de interagir com os dados armazenados na blockchain. Ele permite visualizar diretamente os documentos JSON armazenados pelos chaincodes, executar consultas complexas e realizar debug do estado mundial (world state) da rede.

Para acessar o fauxton, basta abrir um dos links abaixo para a org qu deseja verificar:

```bash
    Org1: http://localhost:5984/_utils/

    Org2: http://localhost:7984/_utils/

    Org3: http://localhost:9984/_utils/
```
As credenciais de acesso são:

```bash
user: admin
senha: adminpw
```

## Mais

Mais documentação e detalhes sobre o `cc-tools` pode ser encontrado em [https://goledger-cc-tools.readthedocs.io/en/latest/](https://goledger-cc-tools.readthedocs.io/en/latest/)
