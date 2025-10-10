'use client'

import { ThemeProvider } from 'styled-components'
import { greenCRT } from '@/styles/themes'
import original from 'react95/dist/themes/original';
import aiee from 'react95/dist/themes/aiee';
import cherry from 'react95/dist/themes/cherry';
import tooSexy from 'react95/dist/themes/tooSexy';

import { styleReset } from 'react95'
import { createGlobalStyle } from 'styled-components'
import { SolanaWalletProvider } from './wallet-provider'

const GlobalStyles = createGlobalStyle`
  ${styleReset}

  @font-face {
    font-family: 'ms_sans_serif';
    src: url('https://unpkg.com/react95@4.0.0/dist/fonts/ms_sans_serif.woff2') format('woff2');
    font-weight: 400;
    font-style: normal;
  }

  @font-face {
    font-family: 'ms_sans_serif';
    src: url('https://unpkg.com/react95@4.0.0/dist/fonts/ms_sans_serif_bold.woff2') format('woff2');
    font-weight: 700;
    font-style: normal;
  }

  * {
    box-sizing: border-box;
  }

  body, input, select, textarea, button {
    font-family: 'ms_sans_serif', 'MS Sans Serif', Arial, sans-serif;
    margin: 0;
    padding: 0;
  }
`

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SolanaWalletProvider>
      <ThemeProvider theme={greenCRT}>
        <GlobalStyles />
        {children}
      </ThemeProvider>
    </SolanaWalletProvider>
  )
}
