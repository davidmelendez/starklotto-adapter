import {
  deployContract,
  executeDeployCalls,
  exportDeployments,
  deployer,
} from "./deploy-contract";
import { green } from "./helpers/colorize-log";

/**
 * Deploy a contract using the specified parameters.
 *
 * @example (deploy contract with constructorArgs)
 * const deployScript = async (): Promise<void> => {
 *   await deployContract(
 *     {
 *       contract: "YourContract",
 *       contractName: "YourContractExportName",
 *       constructorArgs: {
 *         owner: deployer.address,
 *       },
 *       options: {
 *         maxFee: BigInt(1000000000000)
 *       }
 *     }
 *   );
 * };
 *
 * @example (deploy contract without constructorArgs)
 * const deployScript = async (): Promise<void> => {
 *   await deployContract(
 *     {
 *       contract: "YourContract",
 *       contractName: "YourContractExportName",
 *       options: {
 *         maxFee: BigInt(1000000000000)
 *       }
 *     }
 *   );
 * };
 *
 *
 * @returns {Promise<void>}
const deployScript = async (): Promise<void> => {
  await deployContract(
     {
       contract: "YourContract",
       contractName: "YourContractExportName",
       constructorArgs: {
         owner: deployer.address,
       },
       options: {
         maxFee: BigInt(1000000000000)
       }
     }
   );
 };

*/

const deployScript = async (): Promise<void> => {
  // Dirección del VRF provider de Cartridge en Sepolia testnet
  const VRF_PROVIDER_ADDRESS =
    "0x051fea4450da9d6aee758bdeba88b2f665bcbf549d2c61421aa724e9ac0ced8f";

  await deployContract({
    contract: "Randomness",
    constructorArgs: {
      owner: deployer.address,
      vrf_coordinator: VRF_PROVIDER_ADDRESS,
      dev_mode: true,
    },
  });
};

const main = async (): Promise<void> => {
  try {
    await deployScript();
    await executeDeployCalls();
    exportDeployments();

    console.log(green("All Setup Done!"));
  } catch (err) {
    console.log(err);
    process.exit(1); //exit with error so that non subsequent scripts are run
  }
};

main();
