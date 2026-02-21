/// <reference types="vite/client" />

import type { TempDLMApi } from '../preload/index'

declare global {
  interface Window {
    tempdlm: TempDLMApi
  }
}
