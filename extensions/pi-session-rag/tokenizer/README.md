# BGE-M3 토크나이저

임베딩 입력의 토큰 수만 계산하는 로컬 자산입니다. 모델 가중치는 포함하지 않습니다.
실행 중 Hugging Face에 대화 내용을 보내거나 자산을 자동 다운로드하지 않습니다.

- 원본: [BAAI/bge-m3](https://huggingface.co/BAAI/bge-m3), 모델 카드의 라이선스는 MIT입니다.
- 고정 리비전: `5617a9f61b028005a4858fdac845db406aefb181`
- [tokenizer.json](https://huggingface.co/BAAI/bge-m3/resolve/5617a9f61b028005a4858fdac845db406aefb181/tokenizer.json): 17,098,108 bytes, SHA-256 `21106b6d7dab2952c1d496fb21d5dc9db75c28ed361a05f5020bbba27810dd08`
- [tokenizer_config.json](https://huggingface.co/BAAI/bge-m3/resolve/5617a9f61b028005a4858fdac845db406aefb181/tokenizer_config.json): XLMRobertaTokenizer, `model_max_length: 8192`

`@huggingface/tokenizers@0.2.0`은 JavaScript로 토큰을 계산하며 시작·종료 특수 토큰도 포함합니다. JSON 자산의 자르기·패딩 설정은 허용하지 않습니다.
이 라이브러리의 Precompiled 정규화 구현과 Cloudflare 서버가 모든 입력에서 동일하다고 보장할 수는 없습니다. 요청은 `truncate_inputs: false`로 보내고, 서비스가 명확한 길이 초과를 반환한 경우에만 원문을 더 작게 나눕니다.
