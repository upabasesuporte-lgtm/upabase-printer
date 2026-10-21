export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Cor principal da marca, tirada do logo upabase (meio do degradê roxo → azul → verde-água).
        // Use em botões principais, seleção, links e foco. Status (pago/baixo/zerado) continua verde/âmbar/vermelho.
        brand: {
          50: "#EFF3FF",
          100: "#DFE7FF",
          200: "#C4D2FF",
          300: "#9BB2FE",
          400: "#6A88FC",
          500: "#4469FB",
          600: "#315DFB",
          700: "#2547D6",
          800: "#1E3AAF",
          900: "#1C338A",
        },
      },
      backgroundImage: {
        // Degradê do logo — só para momentos de marca (logo, item ativo do menu, login), nunca em dados
        "brand-gradient": "linear-gradient(135deg, #7C3FFA 0%, #315DFB 50%, #00D7B1 100%)",
      },
    },
  },
  plugins: [],
};
