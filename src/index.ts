class NgnBanksRegistry {
  private banks: Bank[];

  constructor() {
    this.banks = require("../_data/banks.json");
  }

  /**
   * Get all banks
   * @returns An array of bank objects
   */

  getBanks(): Bank[] {
    return this.banks;
  }

  /**
   * Get a bank by its code
   * @param code The code of the bank
   * @returns The bank object
   */

  getBankByCode(code: string): Bank | undefined {
    return this.banks.find((bank) => bank.code === code);
  }
}

export default new NgnBanksRegistry();
