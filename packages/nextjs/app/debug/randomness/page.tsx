import { RandomnessTest } from "./_components/RandomnessTest";
import type { NextPage } from "next";
import { getMetadata } from "~~/utils/scaffold-stark/getMetadata";

export const metadata = getMetadata({
  title: "Testear Aleatoriedad VRF",
  description:
    "Página dedicada para probar la generación de números aleatorios usando Cartridge VRF",
});

const RandomnessTestPage: NextPage = () => {
  return <RandomnessTest />;
};

export default RandomnessTestPage;
