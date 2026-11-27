---
title: Cómo controlar sus gastos automáticamente
description: Conecte su banco, deje que beneficiarios, reglas e IA clasifiquen cada transacción y controle sus gastos con cinco minutos de revisión a la semana.
published: 2026-11-25
related:
  - /features/bank-sync
  - /features/automation-rules
  - /features/ai-categorization
docs:
  - label: Conexiones bancarias
    href: https://docs.moneymatter.app/import/bank-connections/
  - label: Beneficiarios
    href: https://docs.moneymatter.app/transactions/payees/
  - label: Funciones de IA
    href: https://docs.moneymatter.app/ai/ai-features/
---

Casi todo el mundo deja de controlar sus gastos por el mismo motivo: apuntar cada café cansa antes de un mes. El seguimiento automático elimina esa tarea. Sus transacciones llegan solas, cada una recibe un beneficiario y una categoría, y a usted solo le queda una revisión corta una vez a la semana.

MoneyMatter lo hace en tres capas. La sincronización bancaria trae las transacciones. Los beneficiarios y las reglas clasifican las que ve todos los meses. La IA clasifica el resto.

## Conecte su banco

La sincronización bancaria forma parte del plan Plus, y la prueba gratuita de 40 días la incluye, sin necesidad de tarjeta. MoneyMatter se conecta a través de varios proveedores, según dónde tenga su banco:

- **Lunch Flow** cubre más de 20.000 bancos de EE. UU., Canadá, la UE, el Reino Unido, Australia y Nueva Zelanda.
- **SimpleFIN** cubre EE. UU. y Canadá.
- **Akahu** cubre la mayoría de los bancos de Nueva Zelanda, y **Monobank** se conecta directamente en Ucrania.

Lunch Flow y SimpleFIN cobran por su propio servicio, aparte de su plan de MoneyMatter. Akahu y Monobank no suponen ningún coste adicional.

Para conectar:

1. En la barra lateral, abra **Cuentas** → **Todas las cuentas**.
2. En la sección **Conexiones bancarias**, haga clic en **Conectar banco**.
3. Elija su región y su proveedor, pegue la clave de su proveedor y haga clic en **Conectar**.
4. Elija las cuentas que quiera.

La conexión es de solo lectura. MoneyMatter puede ver cuentas, saldos y transacciones, pero no puede mover dinero, y la contraseña de su banco nunca se guarda.

![Página de una conexión bancaria con el saldo total, el número de cuentas conectadas, la sincronización automática cada 12 horas, la hora de la última sincronización, un botón «Sync now» y el menú «Manage» abierto](/img/landing/screenshots/features/import/bank-connection-details@2x.webp)

Si ya controla una cuenta a mano, no tiene que empezar de cero. Conecte el banco sin esa cuenta, abra después la cuenta y vincúlela desde su pestaña **Conexión de datos**. Su historial se conserva y la sincronización continúa desde ahí.

## Elija cuándo se sincroniza

MoneyMatter sincroniza sus cuentas conectadas dos veces al día, a las dos horas que usted elija en **Ajustes** → **General**. Fije una a primera hora de la mañana y los gastos de ayer ya estarán ahí cuando mire su presupuesto. Abrir la aplicación también puede iniciar una sincronización, y el botón de la nube de la cabecera permite sincronizar al instante.

## Deje que los beneficiarios se ocupen de las tiendas que visita cada semana

MoneyMatter lee el nombre del comercio de cada transacción sincronizada y lo vincula a un beneficiario. De forma predeterminada, cuando dos transacciones comparten un nombre nuevo, crea el beneficiario por usted. Las grafías parecidas, como «LIDL 1234» y «LIDL SAGT DANKE», se guardan como alias del mismo beneficiario.

Asigne una **Categoría predeterminada** a un beneficiario una sola vez y cada transacción nueva de ese beneficiario recibirá esa categoría. Su ajuste **Categorización con IA** decide lo estricto que es:

- **Usar siempre la categoría del beneficiario** va bien para una tienda en la que siempre compra el mismo tipo de cosas, como su supermercado.
- **Usar como orientación** va bien para una tienda que vende de todo, como una gran tienda en línea. Primero se aplica la categoría del beneficiario, y la IA puede sustituirla según los detalles de la transacción.

Un beneficiario también puede añadir etiquetas a sus transacciones, como una etiqueta **Hogar** para las compras compartidas.

![Página de un beneficiario con su número de transacciones, flujo neto y categoría principal, la sección «Categorization» con una categoría predeterminada y «AI categorization» en «Always use payee category», y dos alias](/img/landing/screenshots/features/transactions/payee-detail-page@2x.webp)

## Escriba reglas para lo que pueda describir con exactitud

Los beneficiarios funcionan por comercio. Una regla funciona con cualquier cosa que pueda describir: el texto del comercio, el importe, la cuenta o el día del mes. Por ejemplo:

- El texto del comercio contiene «uber» o «bolt»: asignar la categoría Transporte.
- El importe es exactamente 1.200 y el día va del 1 al 5: asignar la categoría Alquiler y el beneficiario a su casero.
- La cuenta es su tarjeta compartida: añadir la etiqueta Hogar.

Para crear una, abra **Transacciones** → **Automatizaciones** en la barra lateral. Una regla puede asignar la categoría, las etiquetas, el beneficiario o la nota, y se ejecuta con cada transacción nueva que llega por la sincronización bancaria y por la importación de archivos. Las reglas están incluidas en todos los planes.

![El formulario «Edit automation» de una regla «Monthly rent», con condiciones de nota, tipo de transacción, importe y cuenta, acciones para asignar categoría y beneficiario, y una sección «Preview»](/img/landing/screenshots/features/automations/automation-form@2x.webp)

Una regla nueva no modifica por sí sola sus transacciones anteriores. Para ordenarlas, aplique la regla guardada, marque en la lista de revisión las coincidencias que quiera y confirme.

## Deje que la IA categorice todo lo demás

Las transacciones nuevas que salen de la sincronización bancaria sin categoría pasan a la IA unos segundos después de llegar. La IA elige de su propia lista de categorías, así que el resultado encaja con la forma en que ya hace su presupuesto.

La IA ve el importe, la moneda, la fecha, el nombre de la cuenta, la nota y el beneficiario de cada transacción, además de los nombres de sus categorías. No se envían sus saldos. Nunca sobrescribe una categoría que haya puesto usted a mano ni una que haya asignado una regla.

La IA no aprende de sus correcciones. Cuando corrija el mismo error dos veces, asigne una categoría predeterminada a ese beneficiario o escriba una regla, y el error desaparece para siempre.

Plus incluye la IA de MoneyMatter con una cuota mensual, y la prueba gratuita también. En Esencial, la categorización con IA funciona con su propia clave de OpenAI, Anthropic o Gemini.

![La pestaña «AI Features» de «AI Settings», con el medidor «Included AI usage» arriba y la lista de funciones, cada una con el modelo que la ejecuta](/img/landing/screenshots/features/ai/ai-features-tab@2x.webp)

## Cuál prevalece

Cuando más de una capa podría asignar una categoría, MoneyMatter sigue este orden:

1. Un cargo recurrente que coincida asigna la categoría primero.
2. Una regla va después, y tiene prioridad sobre la categoría predeterminada de un beneficiario.
3. La IA categoriza lo que siga sin categoría.

Ponga su conocimiento más específico en reglas y beneficiarios, y deje a la IA la cola larga.

## Las transferencias entre sus cuentas no son gasto

Cuando pasa dinero de su cuenta corriente a sus ahorros, ambas partes llegan desde su banco. Si contaran como gasto e ingreso, los dos totales parecerían mayores de lo que son.

MoneyMatter las vincula por usted. Cuando una transacción sincronizada tiene exactamente una coincidencia en otra cuenta conectada, con el mismo importe y la misma moneda en sentido contrario dentro de 3 días, la pareja se convierte en una transferencia y deja de contar en sus estadísticas de gasto. Un cambio entre dos monedas suele necesitar su ayuda: abra la transacción, seleccione la pestaña **Transferencia** y vincule usted mismo la otra parte.

## Revise su semana en cinco minutos

Automático no significa que no mire nunca. Una vez a la semana, abra **Transacciones** y repase las nuevas:

- Corrija todo lo que haya acabado en la categoría equivocada.
- Mire lo que sigue en su categoría predeterminada, normalmente **Otros**.
- Cuando haga la misma corrección por segunda vez, conviértala en una categoría predeterminada del beneficiario o en una regla.

Cada corrección que convierte en regla es una que no vuelve a hacer, así que la lista se acorta cada semana.

## Si su banco no es compatible

Aun así puede evitar teclear. Importe un archivo CSV, OFX o QFX de su banco, o suba un extracto en PDF y deje que la IA extraiga las transacciones. Los beneficiarios y las reglas también funcionan con las transacciones importadas. Las transacciones de un extracto en PDF pasan además por la categorización con IA, y con un archivo CSV puede ejecutarla usted mismo desde **Transacciones** → **Optimizaciones**. En Esencial, que no incluye sincronización bancaria, así es como las reglas reciben sus transacciones.
