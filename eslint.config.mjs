import { defineConfig } from 'eslint/config'
import { fixupConfigRules } from '@eslint/compat'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig(fixupConfigRules([
  ...nextVitals,
  ...nextTs,
]))
