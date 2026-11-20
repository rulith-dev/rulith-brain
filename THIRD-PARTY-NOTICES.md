# Third-party software in Rulith Brain

Rulith Brain comes in three packages. Each carries the full licence texts of the parts listed for it: the runtime in
`licenses\`, the desktop app in `runtime\licenses\` (Python's own in `runtime\python\LICENSE.txt`), the agent in
`THIRD-PARTY-NOTICES.txt` and `node\LICENSE`. Rulith Brain is Copyright (c) 2026 Victor Shaw; Rulith's own code is
under the Rulith Brain licence agreement (EULA.md), and the code it takes from Rulith Inference is MIT, Copyright (c)
2026 Victor Shaw. Where to get the source of the LGPL and MPL components: the last section. The numbers of packages
below are those of version 0.2.0.

## The runtime (`rulith-brain-runtime-<version>.zip`)

The memory server (`llama-server.exe` and its DLLs) is built from Rulith Inference's fork of llama.cpp with Rulith
Brain's closed memory code added. The fork's licence file (`licenses\LICENSE-llama.cpp`) also names Rulith Inference's
open changes; the closed memory code is not under it.

- **llama.cpp / ggml** - MIT, Copyright (c) 2023-2026 The ggml authors. https://github.com/ggml-org/llama.cpp, revision
  `19ab5a5e65736a35437e6b1c0ccd6562fed01b1b`.
- **hipfire** (a GPU kernel adapted from it, v0.4.2.1-13-gbfb90b9) - Apache License 2.0, Copyright (c) 2026 Kaden
  Schutt and hipfire contributors; its NOTICE is included.
- **Crucible** (GPU kernels) - Apache License 2.0, Copyright 2026 jaedync; its NOTICE is included.
- **ExLlamaV3** (EXL3 kernels, by way of its gfx11.5 port by Yamz Labs, which carries the same licence) - MIT,
  Copyright (c) 2025 Turboderp.
- Libraries llama.cpp builds into the server:
  - **cpp-httplib** 0.62.0 - MIT, Copyright (c) 2017 yhirose.
  - **JSON for Modern C++** 3.12.0 - MIT, Copyright (c) 2013-2025 Niels Lohmann.
  - **xxHash** - BSD 2-Clause, Copyright (c) 2012-2021 Yann Collet.
  - **rotate-bits** - MIT, Copyright (c) 2021 William Casarin.
  - **stb_image** 2.30 (Sean Barrett), **miniaudio** 0.11.25 (David Reid), **subprocess.h** (sheredom), SHA-1 (Steve
    Reid), SHA-256 (Igor Pavlov) - public domain (stb_image and miniaudio also offer MIT / MIT-0); no notice required.
- Code adapted inside ggml and llama.cpp:
  - ggml's CPU matrix multiplication (sgemm) - MIT, Copyright 2024 Mozilla Foundation.
  - **YaRN** context scaling - MIT, Copyright (c) 2023 Jeffrey Quesnelle and Bowen Peng.
  - **Pillow**'s image resampling - MIT-CMU licence, Copyright 1997-2011 Secret Labs AB, 1995-2011 Fredrik Lundh and
    contributors, 2010 Jeffrey 'Alex' Clark and contributors.
- **AMD ROCm** (the SDK wheels `rocm 10.2.0a20260925`), the two DLLs beside the server:
  - `amdhip64_7.dll` - the HIP runtime 7.17 - MIT, Copyright (C) Advanced Micro Devices, Inc.
  - `amd_comgr.dll` - the Code Object Manager 3.5.0 - Apache License 2.0 with LLVM Exceptions, and the legacy
    University of Illinois/NCSA licence, Copyright (c) 2018-2025 Advanced Micro Devices, Inc. It contains:
    - **LLVM, Clang and LLD** (ROCm's llvm-project, commit `4f43f474`) - Apache License 2.0 with LLVM Exceptions, and
      the legacy University of Illinois/NCSA licence, Copyright (c) 2003-2019 University of Illinois at
      Urbana-Champaign.
    - **zstd** - BSD 3-Clause, Copyright (c) Meta Platforms, Inc. and affiliates.
    - **zlib** 1.3.2 - zlib licence, Copyright (C) 1995-2026 Jean-loup Gailly and Mark Adler.

The rest of ROCm and the Visual C++ and OpenMP runtimes come from the app that runs the server (the Rulith Brain desktop
app), with that app's notices below.

## The desktop app (`Rulith-Brain-Setup-<version>.exe`)

The app (`rulith-brain.exe`, a Tauri window around the Brain page) and what its setup lays down under `runtime\`. The
Brain page itself has no third-party code.

- **Tauri** 2.10.3 and the other Rust crates linked into `rulith-brain.exe` - 190 crates, each under its own licence;
  their texts are in `runtime\licenses\LICENSES-rust-crates.txt`, generated at build time from the crates
  `cargo tree --target x86_64-pc-windows-msvc -e normal,no-proc-macro` lists and the licence files each crate ships.
  By licence: MIT OR Apache-2.0 123, MIT 32, Unicode-3.0 15 (ICU4X), MIT OR Unlicense 6, Apache-2.0 2 (tao,
  sync_wrapper), ISC 2 (rustls-webpki, untrusted), MIT OR Apache-2.0 OR ISC 2 (rustls, hyper-rustls), and one each of
  Apache-2.0 AND ISC (ring), Apache-2.0 AND MIT (dpi), Apache-2.0 OR BSL-1.0 (ryu), BSD-3-Clause (subtle),
  Apache-2.0 OR CC0-1.0 OR MIT-0 (dunce), CDLA-Permissive-2.0 (webpki-roots), MIT OR Apache-2.0 OR Zlib
  (raw-window-handle) and MPL-2.0 (option-ext 0.2.0, unmodified; its source: https://crates.io/crates/option-ext/0.2.0).
- **WebView2 loader** (Microsoft WebView2 SDK 1.0.3296.44, linked into the app) - BSD-style licence, Copyright (C)
  Microsoft Corporation. The WebView2 Runtime itself is not shipped: Windows has it, or the setup downloads and runs
  Microsoft's installer for it.
- **NSIS** 3.08 (the setup and the uninstaller) - zlib/libpng licence, Copyright (C) 1999-2021 Contributors; its LZMA
  module - Common Public License 1.0 with its authors' linking exception. Tauri's NSIS plugin - MIT OR Apache-2.0.
- **Python** 3.12.10 (the embeddable distribution; it runs the manager) - PSF License Agreement, with the licences of
  the components it includes (OpenSSL, SQLite, libffi, bzip2, expat, zlib and others): `runtime\python\LICENSE.txt`.
- **AMD ROCm** (the same SDK as the runtime), in `runtime\bin\hip`:
  - `amdhip64_7.dll`, `amd_comgr.dll` - as in the runtime above.
  - `hipblas.dll` (hipBLAS 3.8) - MIT, Copyright (C) Advanced Micro Devices, Inc.
  - `rocblas.dll` (rocBLAS 5.8) with its kernels (`rocblas\library` and `..\.kpack\blas_lib_gfx1151.kpack`) - MIT,
    Copyright (C) Advanced Micro Devices, Inc., with the BSD notices of the code it includes (University of Tennessee,
    STFC, LAPACK).
  - `libhipblaslt.dll` (hipBLASLt 1.5), `libtensilelite-host.dll`, `origami.dll` and `hipblaslt\library` - MIT,
    Copyright (C) Advanced Micro Devices, Inc.
  - `rocsolver.dll` (rocSOLVER 3.38) - BSD 2-Clause, Copyright (c) 2018-2025 Advanced Micro Devices, Inc., with the
    LAPACK and MAGMA notices.
  - `rocm_kpack.dll` - MIT, Copyright (c) 2025 Advanced Micro Devices, Inc.
  - Inside these: msgpack-c (Boost Software License 1.0) and zlib (zlib licence), neither needing a notice in a binary.
- **Microsoft Visual C++ runtime** 14.44 (`msvcp140.dll`, `vcruntime140.dll`, `vcruntime140_1.dll`) - the Visual C++
  Redistributable, distributed under the Visual Studio licence terms.
- **LLVM OpenMP runtime** (`libomp140.x86_64.dll`, Microsoft's build, from the Visual C++ redistributable) - Apache
  License 2.0 with LLVM Exceptions; Microsoft's redistribution terms.
- **Rulith Inference**'s manager, downloader and model catalog - MIT, Copyright (c) 2026 Victor Shaw
  (`runtime\licenses\LICENSE-rulith-inference`).

## The agent (`rulith-brain-agent-<version>.zip`)

- **DeepSeek Harness (dsh)** 0.2.1-alpha.1 - MIT, Copyright (c) 2026 DeepSeek.
  https://github.com/deepseek-ai/deepseek-harness. The Rulith Brain Agent is dsh's web app with Rulith's forwarder;
  the package changes a few of dsh's page texts and its icon to carry the product's name (listed in
  `THIRD-PARTY-NOTICES.txt`). The same licence covers the 278 other `@deepseek-ai` packages it ships.
- **Node.js** v24.12.0 (`node\node.exe`) - MIT, Copyright Node.js contributors, with the licences of the components it
  includes (V8, OpenSSL, ICU, libuv and others): `node\LICENSE`.
- The npm packages in `app\node_modules` - 604, each with its licence text in `THIRD-PARTY-NOTICES.txt` (generated
  when the package is made). By licence: MIT 509, Apache-2.0 57, BSD-3-Clause 15, ISC 13, BSD-2-Clause 3, MPL-2.0 2
  (LibreOffice, below), and one each of Python-2.0 (argparse), Unlicense (fast-sha256), 0BSD (tslib), MIT OR CC0-1.0
  (type-fest) and Apache-2.0 AND LGPL-3.0-or-later (sharp, below).
- Four of them ship prebuilt native binaries. Section 6 of `THIRD-PARTY-NOTICES.txt` names what is inside each, adds
  the licence texts the npm package does not carry itself and says where the exact source is:
  - **LibreOffice** 26.8.0.3 (`@deepseek-ai/libreoffice-kit-win32-x64` 0.1.5, dsh's reader for Office documents; left
    out of a package made without it) - Mozilla Public License 2.0, Copyright 2000-2026 LibreOffice contributors, with
    the third-party licences (LGPL and others) its `license.txt` lists.
  - **libvips** 8.18.7 and the libraries built into it (`@img/sharp-win32-x64` 0.35.5, sharp's image processing; the
    build of sharp-libvips 1.3.4) - libvips, glib, pango, fribidi, libheif, librsvg, libexif and proxy-libintl: GNU
    LGPL, used under version 3.0 (the LGPL 3.0 and GPL 3.0 texts are included); cairo 1.18.6: MPL 1.1; aom, cgif,
    expat, fontconfig, freetype, harfbuzz, highway, lcms, libarchive, libffi, libimagequant, libnsgif, libpng, libtiff,
    libultrahdr, libwebp, libxml2, mozjpeg, pixman and zlib-ng: their permissive licences, each text included. sharp
    itself: Apache License 2.0, Copyright 2013 Lovell Fuller and others.
  - **ONNX Runtime** 1.28.2 (in `sherpa-onnx-win-x64` 1.13.8, speech) - MIT, Copyright (c) Microsoft Corporation, with
    its ThirdPartyNotices. sherpa-onnx itself: Apache License 2.0, the next-gen Kaldi team.
  - **ConPTY** 1.25.260303002-preview (`conpty.dll`, `OpenConsole.exe` in `node-pty` 1.2.0-beta.15, from Windows
    Terminal) - MIT, Copyright (c) Microsoft Corporation, with Windows Terminal's third-party notices. node-pty itself:
    MIT, Copyright (c) 2012-2015 Christopher Jeffrey.

## Source code of the LGPL and MPL components

The agent package holds components under the GNU LGPL and the Mozilla Public License. Their exact source:

- **LibreOffice** 26.8.0.3 (tag `libreoffice-26.8.0.3`, commit `bce0998afefdbc355585ca324285661a2170ba77`):
  https://download.documentfoundation.org/libreoffice/src/26.8.0/libreoffice-26.8.0.3.tar.xz, with the external
  libraries its build fetches from https://dev-www.libreoffice.org/src/; the changes and build settings of this build
  are in the package (`app\node_modules\@deepseek-ai\libreoffice-kit-win32-x64\sources`) and at
  https://github.com/deepseek-ai/dsh-libreoffice-kit.
- **libvips** 8.18.7: https://github.com/libvips/libvips/releases/tag/v8.18.7. The Windows build in the package and its
  build scripts: https://github.com/libvips/build-win64-mxe/releases/tag/v8.18.7 (`vips-dev-x64-web-8.18.7-static.zip`);
  the version of every library in it: https://github.com/lovell/sharp-libvips/tree/v1.3.4 (`versions.properties`, and
  `versions.json` in the package); the source of each at that version is at its project's address.

Written offer: on request, the licensor of Rulith Brain (see EULA.md) also provides the complete
corresponding source code of these components, for the version of the agent package you received, for at least three
years from that version's release, at no more than the cost of providing it. Write to contact@rulith.com.
