/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          // Parejas suaves para etiquetas y avisos (las mismas que MultiCRM): se
          // trajeron con Certifex, que las usa. Correctas en claro y en oscuro.
          soft: 'hsl(var(--destructive-soft))',
          'soft-foreground': 'hsl(var(--destructive-soft-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          soft: 'hsl(var(--success-soft))',
          'soft-foreground': 'hsl(var(--success-soft-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          soft: 'hsl(var(--warning-soft))',
          'soft-foreground': 'hsl(var(--warning-soft-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
          soft: 'hsl(var(--info-soft))',
          'soft-foreground': 'hsl(var(--info-soft-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      // Los tamaños con nombre del rediseño (#32), iguales que en MultiCRM. Faltaban
      // aquí y el código ya los usaba (text-normal, text-secundario, text-tabla):
      // sin ellos esas clases no hacían nada (revisado el 06/10, #106).
      fontSize: {
        // 20px · el título de la pantalla
        titulo: ['1.25rem', { lineHeight: '1.75rem', fontWeight: '600' }],
        // 16px · el título de un bloque dentro de la pantalla
        seccion: ['1rem', { lineHeight: '1.5rem', fontWeight: '600' }],
        // 14px · el texto de siempre
        normal: ['0.875rem', { lineHeight: '1.25rem' }],
        // 12px · lo que acompaña: ayudas, metadatos, pies
        secundario: ['0.75rem', { lineHeight: '1rem' }],
        // 11px · cabecera de tabla. Va con `uppercase`; el espaciado y el peso
        // ya vienen puestos, que a este tamaño en mayúsculas hacen falta.
        tabla: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.06em', fontWeight: '600' }],
        // 28px · las cifras que se miran de lejos. Siempre con tabular-nums.
        cifra: ['1.75rem', { lineHeight: '2.25rem', fontWeight: '600' }],
      },
      // El ritmo de la pantalla (#32), igual que en MultiCRM. Faltaba aquí y el
      // código ya lo usaba (p-tarjeta, space-y-bloque, gap-tarjeta en
      // `FilaCampos`…): sin esto esas clases no hacían nada y los campos de una
      // fila salían pegados (revisado el 16/10, #106).
      //
      //   space-y-bloque   entre los bloques de una pantalla
      //   p-tarjeta        relleno de una tarjeta      (lo pone <Card>)
      //   gap-fila         entre controles de una fila
      spacing: {
        bloque: '1.5rem',   // 24px
        tarjeta: '1rem',    // 16px
        fila: '0.5rem',     // 8px
      },
      borderRadius: {
        '2xl': 'calc(var(--radius) + 4px)',
        xl: 'calc(var(--radius) + 2px)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
