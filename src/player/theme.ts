/** Colours alphaTab draws the score with, matched to the app's light and dark themes. */
export function scoreColors(dark: boolean) {
  return dark
    ? {
        mainGlyphColor: '#e8e6e3',
        secondaryGlyphColor: '#e8e6e399',
        scoreInfoColor: '#e8e6e3',
        staffLineColor: '#6b6f76',
        barSeparatorColor: '#8a8f98',
        barNumberColor: '#ff9d66',
      }
    : {
        mainGlyphColor: '#1b1d21',
        secondaryGlyphColor: '#1b1d2199',
        scoreInfoColor: '#1b1d21',
        staffLineColor: '#a4a9b3',
        barSeparatorColor: '#4b5059',
        barNumberColor: '#c2410c',
      }
}
