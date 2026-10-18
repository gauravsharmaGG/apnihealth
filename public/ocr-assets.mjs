// The pinned third-party files for reading lab reports in the browser (plan: docs/plans/report-ocr.md, PR 5).
// They are not committed: scripts/vendor-ocr.mjs downloads the npm tarballs, checks every sha256 below and copies
// the listed files into public/vendor/ocr/<OCR_ID>/ (gitignored). build.py runs it. An upgrade is a PR that changes
// this file, and a new OCR_ID means a new URL, so browsers never mix old and new files (they are cached immutable).
// Shared by the vendor script (Node) and the report reader in the browser, which only needs OCR_BASE and the paths.
export const OCR_ID='pdfjs-6.4.299_tess-7.0.0';
export const OCR_BASE=`/vendor/ocr/${OCR_ID}/`;

// What the browser loads, relative to OCR_BASE.
export const PATHS={
 pdf:'pdfjs/pdf.min.mjs',pdfWorker:'pdfjs/pdf.worker.min.mjs',pdfWasm:'pdfjs/wasm/',
 tesseract:'tesseract/tesseract.esm.min.js',tesseractWorker:'tesseract/worker.min.js',core:'core/',lang:'lang/',
};
export const LANGS=['eng','deu','hin']; // eng+deu by default, hin on request

// Each package: the registry tarball and its sha256, then the files to copy ({from: path in the tarball, to: path
// under OCR_BASE, sha256} for code and data; licences are copied unhashed because they are covered by the tarball
// hash). Sizes are for reference only.
const npm=(name,version)=>`https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`;
export const PACKAGES=[
 {name:'pdfjs-dist',version:'6.4.299',license:'Apache-2.0',tarball:npm('pdfjs-dist','6.4.299'),
  sha256:'86269b40170eb41740ea05ad2102d71d33de4f122b34eb2f478be0ea7779c415',
  files:[
   {from:'package/build/pdf.min.mjs',to:'pdfjs/pdf.min.mjs',sha256:'57456c8e0c81e46be31174b499ef77f2b9f5ee46d04412ba627320a36755d4c2',size:458904},
   {from:'package/build/pdf.worker.min.mjs',to:'pdfjs/pdf.worker.min.mjs',sha256:'9536359f1b8367850d485731ca1d5e45c159a7b7a0912325e539937aa21ceb18',size:1264342},
   {from:'package/wasm/openjpeg.wasm',to:'pdfjs/wasm/openjpeg.wasm',sha256:'95e5002597af0824004aa57b1900fe019715db389e37640b1e58395e42f00cc5',size:251131},
   {from:'package/wasm/jbig2.wasm',to:'pdfjs/wasm/jbig2.wasm',sha256:'466f45c2a61a698152fb5400c27e56ff2ceb73dcb71fde3fc366a502308eaab0',size:103671},
   {from:'package/wasm/qcms_bg.wasm',to:'pdfjs/wasm/qcms_bg.wasm',sha256:'663d86126d5f5fcb1c61490f94353e2a8375660b8c5498ab3ebab5a34b08800e',size:96589},
  ],
  licenses:[['package/LICENSE','pdfjs/LICENSE'],...['JBIG2','OPENJPEG','PDFJS_JBIG2','PDFJS_OPENJPEG','PDFJS_QCMS','QCMS'].map(n=>[`package/wasm/LICENSE_${n}`,`pdfjs/wasm/LICENSE_${n}`])]},
 {name:'tesseract.js',version:'7.0.0',license:'Apache-2.0',tarball:npm('tesseract.js','7.0.0'),
  sha256:'9a93bf51c3387f945d10a24bf8b3a4bf2e45c7c7161b8242aafbaf9d3c4b606a',
  files:[
   {from:'package/dist/tesseract.esm.min.js',to:'tesseract/tesseract.esm.min.js',sha256:'64871d76c75609fd5413b88a8171e2ef40deedd77d5875ba23df104b2d05eb29',size:63220},
   {from:'package/dist/worker.min.js',to:'tesseract/worker.min.js',sha256:'576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d',size:111307},
  ],
  licenses:[['package/LICENSE.md','tesseract/LICENSE.md'],['package/dist/tesseract.min.js.LICENSE.txt','tesseract/tesseract.min.js.LICENSE.txt'],['package/dist/worker.min.js.LICENSE.txt','tesseract/worker.min.js.LICENSE.txt']]},
 // Only the LSTM cores (the legacy engine is never used); tesseract.js picks relaxed SIMD, SIMD or plain per device.
 {name:'tesseract.js-core',version:'7.0.0',license:'Apache-2.0',tarball:npm('tesseract.js-core','7.0.0'),
  sha256:'ba584355515eaff877552022853c0e71f2cb70466e759d1d6940484929718ee0',
  files:[
   {from:'package/tesseract-core-lstm.wasm.js',to:'core/tesseract-core-lstm.wasm.js',sha256:'eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680',size:3896484},
   {from:'package/tesseract-core-simd-lstm.wasm.js',to:'core/tesseract-core-simd-lstm.wasm.js',sha256:'c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38',size:3899472},
   {from:'package/tesseract-core-relaxedsimd-lstm.wasm.js',to:'core/tesseract-core-relaxedsimd-lstm.wasm.js',sha256:'861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3',size:3905767},
  ],
  licenses:[['package/LICENSE','core/LICENSE']]},
 // Language models: tessdata_best (Apache-2.0) integerised ("4.0.0_best_int"), packaged by the tesseract.js team.
 ...[['eng','c9bddf2e2f0a214ac7918f3f4a3caf45e09ce8674fe26662ae7787ac8927f7bb','45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91',2952873],
  ['deu','929782d1d505ae09a568c41f2ea73182e84bb323205340abd72654584cd27b2c','306c4280d0cbed46fbff727486bd43b92730181bae80f56941a091f363bdf28b',1333102],
  ['hin','42993832c06b5ccf7d98c6197b8d5cc6e1ebd8d71af07be453a8f28e0322c9b8','f3b6a0d320df38d886178cdd727b90dbf9df3db053adb32bd9cf73f0463cda07',1389692]]
  .map(([lang,tgz,file,size])=>({name:`@tesseract.js-data/${lang}`,version:'1.0.0',license:'Apache-2.0 (model), MIT (package)',
   tarball:npm(`@tesseract.js-data/${lang}`,'1.0.0'),sha256:tgz,
   files:[{from:`package/4.0.0_best_int/${lang}.traineddata.gz`,to:`lang/${lang}.traineddata.gz`,sha256:file,size}],licenses:[]})),
];

// Written next to the files (lang/NOTICE): the model packages carry no licence file of their own.
export const LANG_NOTICE=`The *.traineddata.gz files are Tesseract LSTM models from https://github.com/tesseract-ocr/tessdata_best
(Apache License 2.0, https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE), in the integerised
"4.0.0_best_int" form published on npm as @tesseract.js-data/{eng,deu,hin} 1.0.0 (https://github.com/naptha/tessdata).
`;
