# iNaturalist Sound Classifier (Extensão para Navegador)

Uma extensão de navegador para biólogos e cientistas cidadãos analisarem gravações de áudio diretamente nas páginas de observação do iNaturalist. Executa modelos de aprendizado de máquina localmente no navegador para identificar espécies a partir do som e valida as detecções com dados de ocorrência geográfica do GBIF e iNaturalist. Atualmente restrito a modelos no formato ONNX.

Compatível com **navegadores Chromium** (Chrome, Brave, Edge) e **Firefox**.

## Principais Funcionalidades

* **Inferência Nativa no Navegador:** Executa modelos ONNX localmente usando ONNX Runtime WebAssembly em um Web Worker isolado. Nenhum dado de áudio sai da sua máquina.
* **Suporte Multi-Navegador:** Funciona como extensão Chrome/Chromium (Manifest V3 service worker) e como complemento Firefox (Manifest V3 event page).
* **Filtragem Geográfica:** Filtra automaticamente o registro de modelos com base nas coordenadas da observação, exibindo apenas modelos relevantes para a região.
* **Validação Geográfica:** As melhores detecções são verificadas contra bounding boxes de ocorrência do GBIF e iNaturalist para sinalizar espécies fora da área de distribuição conhecida.
* **Suporte Multi-Modelo:** Inclui **BirdNET v2.4** e **Google Perch v2.0**. Modelos personalizados podem ser adicionados via configuração JSON ou pela interface.
* **Parsing Flexível de Labels:** Arquivos de labels dos modelos podem usar qualquer delimitador (vírgula, tab, ponto e vírgula, underscore, etc.), com opção de pular cabeçalho e seleção de coluna.
* **Ativação Configurável:** Cada modelo especifica sua função de ativação (`softmax`, `sigmoid` ou `none`) na configuração JSON.
* **Cache Local:** Modelos baixados são armazenados no `CacheStorage` do navegador para carregamento instantâneo em sessões futuras.
* **Download por Streaming:** Modelos grandes (400 MB+) são baixados via conexão de streaming com controle de fluxo pelo script de background, evitando picos de memória.
* **Gerenciamento de Memória:** O Web Worker de inferência é encerrado após cada análise para liberar completamente a memória WebAssembly.
* **Interface Multilíngue:** Inglês e Português (BR) incluídos. Outros idiomas podem ser adicionados como arquivos JSON.

---

## Instalação

### A Partir do Código Fonte (Modo Desenvolvedor)

1. **Clone e instale as dependências:**

   ```bash
   git clone https://github.com/biodiversica/inat-sound-classifier.git
   cd inat-sound-classifier
   npm install
   ```

2. **Compile para o seu navegador:**

   ```bash
   # Builds de desenvolvimento (para carregar como extensão descompactada/temporária)
   npm run dev:chrome
   npm run dev:firefox

   # Builds de produção (pacotes zip para submissão nas lojas)
   npm run build:chrome
   npm run build:firefox

   # Compilar ambos
   npm run build
   ```

3. **Carregue a extensão:**

   **Chrome / Brave / Edge:**

   * Navegue até `chrome://extensions`
   * Ative o **Modo do desenvolvedor**
   * Clique em **Carregar sem compactação** e selecione `dist/chrome/`

   **Firefox:**

   * Navegue até `about:debugging#/runtime/this-firefox`
   * Clique em **Carregar complemento temporário** e selecione qualquer arquivo dentro de `dist/firefox/`

4. **Use:** Navegue até qualquer página de observação do iNaturalist com gravações de som. O painel de análise aparece automaticamente.

---

## Estrutura do Projeto

```
inat-sound-classifier/
+-- manifest.json           # Manifesto da extensão (Chrome MV3 como referência)
+-- config.js               # Configuração global e shim de API (chrome/browser)
+-- content.js              # Ponto de entrada: detecção de página, orquestração da análise
+-- model.js                # iNatSCModelEngine: carregamento de modelo, cache, inferência
+-- ui.js                   # iNatSCUI: injeção no DOM, controles, logging
+-- audio.js                # iNatSCAudio: download, decodificação, resampling, chunking
+-- geo.js                  # iNatSCGeo: validação geográfica GBIF/iNaturalist
+-- background.js           # Service worker / event page: proxy CORS, downloads streaming
+-- inference-worker.js     # Web Worker: inferência ONNX Runtime WASM
+-- onnx/                   # Binários WASM do ONNX Runtime (sincronizados do node_modules)
+-- model_zoo/              # Arquivos JSON de configuração de modelos + index.json
+-- language/               # Arquivos JSON de tradução da interface + index.json
+-- styles/                 # Temas CSS (inaturalist.css, biodiversica.css)
+-- scripts/
|   +-- build.js            # Script de build para pacotes Chrome/Firefox
+-- tests/                  # Suíte de testes Jest
+-- package.json
```

---

## Adicionando Modelos Personalizados

### Pela Interface

1. Abra o painel de **Configurações Avançadas** em qualquer página de observação.
2. Cole a configuração JSON do modelo na área de texto **Modelo Personalizado**.
3. Clique em **Adicionar**. O modelo é salvo no `localStorage` e persiste entre sessões.

### Pelo Model Zoo

1. Crie um arquivo JSON em `model_zoo/` seguindo este formato:

   ```json
   {
     "id": "meu_modelo_v1",
     "name": "Meu Modelo",
     "version": 1.0,
     "about": "https://exemplo.com/sobre",
     "modelUrl": "https://exemplo.com/modelo.onnx",
     "labels": {
       "url": "https://exemplo.com/labels.csv",
       "header": true,
       "delimiter": ",",
       "column": 0
     },
     "sampleRate": 48000,
     "windowSize": 3,
     "activation": "sigmoid",
     "inputIndex": 0,
     "outputIndex": 0,
     "bbox": null,
     "format": "onnx",
     "taxa": ["aves"]
   }
   ```

2. Adicione o nome do arquivo em `model_zoo/index.json`.

### Configuração do Arquivo de Labels

| Campo       | Descrição                                                                      |
| ----------- | ------------------------------------------------------------------------------ |
| `url`       | URL do arquivo de labels (texto/CSV)                                           |
| `header`    | `true` para pular a primeira linha como cabeçalho                              |
| `delimiter` | Separador de colunas: `","`, `"\t"`, `";"`, `"_"`, ou `null` para coluna única |
| `column`    | Índice da coluna do nome da espécie (base zero)                                |

### Opções de Ativação

| Valor       | Descrição                                                     |
| ----------- | ------------------------------------------------------------- |
| `"softmax"` | Softmax sobre todos os logits (classes mutuamente exclusivas) |
| `"sigmoid"` | Sigmoid independente por logit (multi-label)                  |
| `"none"`    | Valores brutos dos logits (sem transformação)                 |

---

## Configurações

* **Nível de Confiança:** Filtra resultados pela pontuação do modelo (0.05 a 0.95).
* **Sobreposição (Overlap) %:** Controla a sobreposição entre janelas de análise adjacentes (0% a 90%).
* **Idioma:** Alterna o idioma da interface. Detectado automaticamente pelo idioma do navegador na primeira visita.
* **Limpar Cache:** Remove todos os modelos em cache do `CacheStorage`.

---

## Testes

```bash
npm test
```

Executa a suíte de testes Jest (60 testes) cobrindo `model.js`, `audio.js`, `geo.js` e `ui.js`.

---

## Resolução de Problemas

### Modelos não carregam (Linux)

Verifique sua cota de armazenamento local. Chrome/Brave no Linux armazena o cache da extensão em:

```
~/.config/BraveSoftware/Brave-Browser/Default/Service Worker/CacheStorage/
```

Você pode limpar usando o botão **Limpar Cache** nas Configurações Avançadas.

### Firefox: download do modelo trava

Verifique se a extensão tem permissões para o domínio de hospedagem do modelo. O manifesto inclui wildcards para HuggingFace (`*.huggingface.co`, `*.hf.co`) e Zenodo (`zenodo.org`). URLs de modelos personalizados de outros domínios podem exigir a adição de `host_permissions` no manifesto.

---

## Contribuições

1. Faça um fork do projeto.
2. Crie uma branch para sua funcionalidade (`git checkout -b feature/NovaFuncionalidade`).
3. Execute `npm test` para verificar que todos os testes passam.
4. Faça o commit das alterações (`git commit -m 'Adiciona NovaFuncionalidade'`).
5. Envie para a branch (`git push origin feature/NovaFuncionalidade`).
6. Abra um Pull Request.

---

## Licença

Distribuído sob a licença GPLv3. Veja o arquivo `LICENSE` para mais informações.
