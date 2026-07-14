import { appState } from '../stores/appState.svelte';

export interface NumLine {
  id: string;
  input: string;
  output: string;
  plainOutput: string;
  isError: boolean;
  timestamp: number;
}

export interface NumDocumentV1 {
  version: 1;
  title: string;
  lines: NumLine[];
  createdAt: string;
  modifiedAt: string;
}

export interface NumDocument {
  version: 2;
  title: string;
  text: string;
  createdAt: string;
  modifiedAt: string;
}

export class NumbatEngineClass {
  private wasmModule: any = null;
  private instance: any = null;
  private loadingPromise: Promise<void> | null = null;
  private exchangeRatesLoaded = false;
  private exchangeRatesXml: string | null = null;

  /**
   * Initialize Numbat WASM engine (lazy loaded).
   */
  public async init(): Promise<void> {
    if (this.instance) return;

    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    this.loadingPromise = (async () => {
      try {
        // Dynamic import of the WASM pkg
        // @ts-ignore
        this.wasmModule = await import('../wasm/numbat/numbat_wasm.js');
        
        // Initialize WASM module
        await this.wasmModule.default();
        
        // Setup panic hook for debugging
        this.wasmModule.setup_panic_hook();
        
        // Create Numbat instance
        // parameters: load_prelude = true, enable_pretty_printing = false, format_type = Html (1)
        // FormatType.JqueryTerminal = 0, FormatType.Html = 1
        const FormatType = this.wasmModule.FormatType;
        this.instance = this.wasmModule.Numbat.new(true, false, FormatType.Html);

        // Load exchange rates before completing initialization to prevent race conditions
        await this.loadExchangeRates();
      } catch (err) {
        console.error('Failed to initialize Numbat WASM engine:', err);
        this.loadingPromise = null;
        throw err;
      }
    })();

    return this.loadingPromise;
  }

  public isReady(): boolean {
    return this.instance !== null;
  }

  /**
   * Run exchange rates fetch and set them.
   */
  private async loadExchangeRates() {
    if (this.exchangeRatesLoaded || !this.instance) return;

    // Safety check for Vite HMR to prevent calling set_exchange_rates multiple times 
    // across module reloads, which panics Rust's global OnceCell.
    if (typeof window !== 'undefined' && (window as any).__NUMBAT_EXCHANGE_RATES_SET__) {
       this.exchangeRatesLoaded = true;
       return;
    }

    const markRatesSet = () => {
      this.exchangeRatesLoaded = true;
      if (typeof window !== 'undefined') (window as any).__NUMBAT_EXCHANGE_RATES_SET__ = true;
    };

    const cacheKey = 'numbat-exchange-rates-xml';
    const cacheTimeKey = 'numbat-exchange-rates-time';
    const cachedXml = localStorage.getItem(cacheKey);
    const cachedTime = localStorage.getItem(cacheTimeKey);

    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // Use cache if fresh
    if (cachedXml && cachedTime && now - parseInt(cachedTime, 10) < oneDayMs) {
      try {
        this.instance.set_exchange_rates(cachedXml);
        this.exchangeRatesXml = cachedXml;
        markRatesSet();
        return;
      } catch (e) {
        console.warn('Error loading cached exchange rates:', e);
      }
    }

    // Try fetching from ECB direct, fallback to Numbat proxy, then Frankfurter API
    let xmlContent = '';
    try {
      // Trying ECB direct (may hit CORS in browser, but good to try)
      const ecbResponse = await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
      if (ecbResponse.ok) {
        xmlContent = await ecbResponse.text();
      }
    } catch (e) {
      // Silent catch, fallback to proxy
    }

    if (!xmlContent) {
      try {
        const proxyResponse = await fetch('https://numbat.dev/ecb-exchange-rates.php');
        if (proxyResponse.ok) {
          xmlContent = await proxyResponse.text();
        }
      } catch (e) {
        // Silent catch, try next source
      }
    }

    // Frankfurter API — CORS-friendly, free, ECB-sourced. Convert JSON to ECB XML.
    if (!xmlContent) {
      try {
        const frankfurterRes = await fetch('https://api.frankfurter.dev/v1/latest');
        if (frankfurterRes.ok) {
          const data = await frankfurterRes.json();
          const date = data.date || new Date().toISOString().slice(0, 10);
          const rates = data.rates as Record<string, number>;
          let cubes = '';
          for (const [currency, rate] of Object.entries(rates)) {
            cubes += `\t\t\t<Cube currency="${currency}" rate="${rate}"/>\n`;
          }
          xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
\t<Cube>
\t\t<Cube time="${date}">
${cubes}\t\t</Cube>
\t</Cube>
</gesmes:Envelope>`;
        }
      } catch (e) {
        console.error('Failed to fetch exchange rates from Frankfurter API:', e);
      }
    }

    if (xmlContent && this.instance) {
      try {
        this.instance.set_exchange_rates(xmlContent);
        this.exchangeRatesXml = xmlContent;
        localStorage.setItem(cacheKey, xmlContent);
        localStorage.setItem(cacheTimeKey, now.toString());
        markRatesSet();
      } catch (e) {
        console.error('Failed to set fetched exchange rates in Numbat:', e);
        // Fall back to currencies without rates
        this.instance.interpret('use units::currencies');
      }
    } else if (this.instance) {
      // Fallback if completely offline / fetch failed and no cache
      try {
        this.instance.set_exchange_rates(FALLBACK_EXCHANGE_RATES_XML);
        this.exchangeRatesXml = FALLBACK_EXCHANGE_RATES_XML;
        markRatesSet();
      } catch (e) {
        console.error('Failed to set fallback exchange rates in Numbat:', e);
        this.instance.interpret('use units::currencies');
      }
    }
  }

  private preprocess(code: string): string {
    return code.replace(/\bto\b/gi, '->');
  }

  /**
   * Interpret a line of Numbat code.
   */
  public interpret(code: string): { output: string; plainOutput: string; isError: boolean; isCommand: boolean; shouldClear: boolean; shouldReset: boolean } {
    if (!this.instance) {
      throw new Error('Numbat engine not initialized. Call init() first.');
    }

    const preprocessed = this.preprocess(code);
    const trimmed = preprocessed.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return { output: '', plainOutput: '', isError: false, isCommand: false, shouldClear: false, shouldReset: false };
    }

    // Run standard interpreter
    try {
      const result = this.instance.interpret(preprocessed);
      return {
        output: result.output,
        plainOutput: this.stripHtml(result.output),
        isError: result.is_error,
        isCommand: false,
        shouldClear: false,
        shouldReset: false
      };
    } catch (e: any) {
      console.error('Numbat interpretation crashed:', e);
      return {
        output: `<span class="numbat-diagnostic-red">Interpreter error: ${e?.message || e}</span>`,
        plainOutput: `Interpreter error: ${e?.message || e}`,
        isError: true,
        isCommand: false,
        shouldClear: false,
        shouldReset: false
      };
    }
  }

  /**
   * Reset Numbat context (clears all user-defined variables/functions)
   */
  public reset(): void {
    if (!this.instance || !this.wasmModule) return;
    
    // Re-create the Numbat instance to clear all state cleanly
    const FormatType = this.wasmModule.FormatType;
    this.instance = this.wasmModule.Numbat.new(true, false, FormatType.Html);
    
    // Exchange rates are already cached globally in Rust OnceCell by loadExchangeRates().
    // We MUST NOT call set_exchange_rates again on a new instance as it will panic 
    // with 'unwrap()' on a populated OnceCell, poisoning the RefCell.
    // We only need to load the currency units into this new context.
    try {
      this.instance.interpret('use units::currencies');
    } catch (e) {
      console.error('Failed to load units::currencies on reset:', e);
    }
  }

  /**
   * Replay a list of successful inputs to re-populate Numbat variable/function context.
   */
  public replaySession(inputs: string[]): void {
    this.reset();
    for (const input of inputs) {
      const trimmed = input.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      // Interpret without command checks, just to build context
      try {
        const preprocessed = this.preprocess(input);
        this.instance.interpret(preprocessed);
      } catch (e) {
        // Skip errors on replay
      }
    }
  }

  /**
   * Get autocomplete completions for a partial input.
   */
  public getCompletions(partial: string): string[] {
    if (!this.instance) return [];
    try {
      const completionsVec = this.instance.get_completions_for(partial);
      // wasm_bindgen returns Vec<JsValue> containing strings
      return Array.isArray(completionsVec) ? completionsVec : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * Expand unicode shortcuts like \pi or \alpha.
   */
  public getUnicodeCompletion(input: string): { len: number; replacement: string } | null {
    if (!this.instance) return null;
    try {
      const res = this.instance.get_unicode_completion(input);
      // Returns a pair [length_of_pattern, replacement_string] or empty array
      if (Array.isArray(res) && res.length === 2) {
        return {
          len: Number(res[0]),
          replacement: String(res[1])
        };
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get formatted help text.
   */
  public getHelp(): string {
    if (!this.instance) return '';
    try {
      return this.instance.help();
    } catch (e) {
      return 'Help text unavailable';
    }
  }

  /**
   * Strip HTML tags from a string to get plain text.
   */
  private stripHtml(html: string): string {
    if (!html) return '';
    // A simple regex strip is sufficient for Numbat's HTML tokens
    return html.replace(/<[^>]*>/g, '');
  }

  /**
   * Free Numbat memory.
   */
  public dispose(): void {
    if (this.instance && typeof this.instance.free === 'function') {
      this.instance.free();
    }
    this.instance = null;
    this.wasmModule = null;
    this.loadingPromise = null;
  }
}

export const NumbatEngine = new NumbatEngineClass();

const FALLBACK_EXCHANGE_RATES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
	<Cube>
		<Cube time="2026-07-14">
			<Cube currency="USD" rate="1.13"/>
			<Cube currency="JPY" rate="175.0"/>
			<Cube currency="BGN" rate="1.9558"/>
			<Cube currency="CZK" rate="24.8"/>
			<Cube currency="DKK" rate="7.46"/>
			<Cube currency="GBP" rate="0.84"/>
			<Cube currency="HUF" rate="395.0"/>
			<Cube currency="PLN" rate="4.18"/>
			<Cube currency="RON" rate="4.97"/>
			<Cube currency="SEK" rate="10.90"/>
			<Cube currency="CHF" rate="0.94"/>
			<Cube currency="ISK" rate="148.0"/>
			<Cube currency="NOK" rate="11.20"/>
			<Cube currency="TRY" rate="43.0"/>
			<Cube currency="AUD" rate="1.68"/>
			<Cube currency="BRL" rate="6.30"/>
			<Cube currency="CAD" rate="1.52"/>
			<Cube currency="CNY" rate="8.10"/>
			<Cube currency="HKD" rate="8.80"/>
			<Cube currency="IDR" rate="18200.0"/>
			<Cube currency="ILS" rate="4.05"/>
			<Cube currency="INR" rate="102.0"/>
			<Cube currency="KRW" rate="1520.0"/>
			<Cube currency="MXN" rate="21.5"/>
			<Cube currency="MYR" rate="4.80"/>
			<Cube currency="NZD" rate="1.82"/>
			<Cube currency="PHP" rate="63.0"/>
			<Cube currency="SGD" rate="1.45"/>
			<Cube currency="THB" rate="38.5"/>
			<Cube currency="ZAR" rate="20.0"/>
		</Cube>
	</Cube>
</gesmes:Envelope>`;
