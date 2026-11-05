-- NOW: região aproximada (~1 km) de quem ligou, só para ordenar "mais perto". Apagada quando o NOW termina.
ALTER TABLE "FlashSession" ADD COLUMN "areaLat" DOUBLE PRECISION;
ALTER TABLE "FlashSession" ADD COLUMN "areaLng" DOUBLE PRECISION;
