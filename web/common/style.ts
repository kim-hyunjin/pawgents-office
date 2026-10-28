// A component's own stylesheet, kept in its .tsx next to the markup it styles. Each sheet nests under the component's
// root selector (#roster { & header { … } }); style.css keeps only the tokens and what several views share.

/** Adopt `text` as a stylesheet; call once at module top level, not per render. */
export function css(text: string) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
