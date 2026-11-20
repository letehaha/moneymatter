---
title: Cómo controlar su dinero en varias monedas
description: Cree cuentas en varias monedas, registre bien los cambios de divisa y los pagos con tarjeta en otra moneda, y vea por qué su patrimonio varía y sus informes no.
published: 2026-10-31
related:
  - /features/multi-currency
  - /features/transfers-and-refunds
  - /features/net-worth-tracker
docs:
  - label: Moneda base y monedas
    href: https://docs.moneymatter.app/settings/base-currency-and-currencies/
  - label: Cómo funcionan las transferencias
    href: https://docs.moneymatter.app/transfers-and-refunds/how-transfers-work/
  - label: Cómo se calculan las estadísticas
    href: https://docs.moneymatter.app/stats/how-stats-are-calculated/
---

Supongamos que cobra en EUR, tiene sus ahorros en USD y paga el alquiler en PLN. Puede consultar cada saldo por separado, pero aun así quiere saber cuánto tiene en total y por qué ese total cambió un día en que no hizo nada.

MoneyMatter responde a ambas preguntas si configura sus cuentas y registra los cambios de divisa como se explica en esta guía.

## Elija su moneda base al registrarse

MoneyMatter muestra todos los totales en su moneda base: el panel, las estadísticas, los informes y los totales de los grupos de cuentas. Elija la moneda con la que compara precios, normalmente aquella en la que más gasta.

La pantalla **Seleccionar moneda base** aparece justo después de registrarse. Viene con USD seleccionado, así que compruébelo antes de hacer clic en **Confirmar moneda**.

Al registrarse puede elegir cualquier moneda. Más adelante solo podrá cambiar a una moneda con un historial largo de tipos de cambio, como USD, EUR, GBP, PLN, UAH, CHF, JPY, CAD o AUD.

## Cree una cuenta por moneda

Cree en MoneyMatter una cuenta por cada cuenta real, en la moneda que esta contiene. El campo **Moneda** solo muestra las monedas que ha añadido. Para añadir otra, desplácese hasta el final de la lista y haga clic en **Añadir nueva moneda +**.

Compruebe la moneda antes de guardar. No podrá cambiarla después, así que si se equivoca tendrá que crear una cuenta nueva.

Si una cuenta bancaria contiene varias monedas, como Revolut, cree una cuenta por moneda: «Revolut EUR» y «Revolut USD». Póngalas en un grupo de cuentas y la barra lateral mostrará su total conjunto en su moneda base.

Las importaciones CSV siguen la misma regla. Si un mismo nombre de cuenta tiene filas en dos monedas, la importación se detiene con un error, así que antes reparta esas filas en el archivo entre nombres de cuenta distintos.

## Introduzca lo que salió de la cuenta

Cada transacción usa la moneda de su cuenta. Introduzca el importe que salió de esa cuenta y MoneyMatter lo convertirá a su moneda base.

- **Paga 50 USD desde su cuenta en USD.** Introduzca 50 en esa cuenta.
- **Paga 50 USD con su tarjeta en EUR.** Introduzca en la cuenta en EUR el importe en EUR que le cobró su banco. Si quiere dejar constancia de los 50 USD, anótelos en **Importe original**. Ese campo no afecta a sus estadísticas.

Para revisar las conversiones, cambie la página de transacciones a **Vista de tabla** y mire la columna **Importe base**.

## Registre los cambios de divisa como transferencias

Supongamos que pasa 500 USD a una tarjeta en EUR y llegan 460 EUR. Si lo registra como un gasto y un ingreso, inflará tanto sus totales de gastos como los de ingresos. Registre una transferencia:

1. Haga clic en **Nueva transacción** y seleccione la pestaña **Transferencia**.
2. Introduzca 500 en **Importe** y elija la cuenta en USD en **Cuenta de origen**.
3. Elija la tarjeta en EUR en **Cuenta de destino** e introduzca 460 en **Importe objetivo**.
4. Haga clic en **Crear**.

Aquí MoneyMatter no propone ningún tipo de cambio. Lo fijan sus dos importes, de modo que el registro coincide con lo que le cobró su banco o su casa de cambio.

Las conexiones bancarias (plan Plus) requieren un paso más. MoneyMatter puede vincular por usted las transferencias en la misma moneda entre cuentas conectadas, pero los cambios entre monedas los vincula usted. Hasta que lo haga, las dos partes cuentan como gasto e ingreso. Abra la transacción importada y seleccione la pestaña **Transferencia**. Si la otra parte ya está registrada, use **Vincular transacción existente**. Si no lo está, elija la otra cuenta.

## Por qué su patrimonio neto cambia aunque no gaste nada

MoneyMatter usa un tipo de cambio distinto para cada clase de cifra:

- **Las transacciones conservan el tipo de cambio de su propia fecha.** Si paga 50 USD el 3 de marzo con EUR como moneda base, MoneyMatter guarda el importe base al tipo de ese día. El informe del mes pasado muestra hoy las mismas cifras que mostraba el mes pasado.
- **Los saldos actuales usan el tipo más reciente.** Los tipos se actualizan una vez al día, a las 18:00 UTC.
- **Los gráficos de saldo usan el tipo de cada día.** El gráfico valora lo que tenía en un día concreto al tipo de ese día.

Supongamos que su moneda base es EUR y tiene 1.000 USD. Si el tipo baja de 0,92 a 0,90, su patrimonio neto cae 20 EUR sin ninguna transacción detrás.

Por la misma razón, si tiene moneda extranjera, los ingresos menos los gastos de un mes no suelen coincidir con la variación de su patrimonio neto. El informe muestra lo que gastó en su momento. El gráfico muestra lo que valía su dinero ese día.

## Use un tipo personalizado solo si quiere un tipo fijo

El tipo de su banco rara vez coincide con el del mercado, así que quizá quiera introducir el suyo. Vaya a **Ajustes** → **Monedas**, despliegue la fila de la moneda, desmarque **Actualización en tiempo real**, escriba el tipo en cualquiera de los dos campos y haga clic en **Guardar**.

![Una fila de PLN desplegada en la página «Currencies», con «Live update» desmarcado, un tipo personalizado de 0.25 introducido y el botón «Save»](/img/landing/screenshots/features/settings/custom-exchange-rate@2x.webp)

Obtiene un único tipo por moneda, sin fecha asociada:

- Las transacciones nuevas y cualquier transacción que edite y guarde lo usan, aunque sean del año pasado. Las transacciones que ya ha guardado conservan sus importes base hasta que las edite.
- Los saldos pasan a usarlo en cuanto guarda. En las cuentas gestionadas manualmente, MoneyMatter también vuelve a calcular todo el historial de saldos con ese tipo, así que el gráfico deja de seguir al mercado para esa moneda.

Yo dejaría activada la **Actualización en tiempo real** en la mayoría de las monedas. No puede fijar un tipo por pago, y una transferencia ya registra el tipo real de cada cambio de divisa. Para volver atrás, marque de nuevo **Actualización en tiempo real** y haga clic en **Guardar**.

## Si se muda de país

Cuando cambie la moneda en la que piensa, cambie su moneda base y conserve sus datos. Vaya a **Ajustes** → **Monedas** y añada la nueva moneda si no aparece en la lista. Después despliegue su fila, haga clic en **Establecer como moneda base** y confirme.

MoneyMatter vuelve a calcular cada transacción al tipo de mercado de su fecha y convierte los saldos al tipo de hoy. Sus importes originales se quedan tal como los introdujo. Antes de empezar:

- **Reserve unos minutos.** Mantenga la pestaña abierta. Hasta que termine, no podrá añadir ni modificar nada que tenga importes, en ningún dispositivo.
- **Deje de compartir antes.** MoneyMatter bloquea el cambio mientras comparta cuentas o pertenezca a un hogar.
- **Cuente con volver a configurar los tipos personalizados.** Los fijó respecto a su antigua moneda base, así que la mayoría de esas monedas vuelven a **En vivo**. Vuelva a fijar su tipo si aún lo quiere.
- **Hágalo una sola vez si puede.** Cambiar de una moneda a otra repetidamente puede dejar los totales convertidos con unos céntimos de diferencia respecto a los iniciales.
