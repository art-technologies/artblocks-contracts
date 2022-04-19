import {
  BN,
  constants,
  expectEvent,
  expectRevert,
  balance,
  ether,
} from "@openzeppelin/test-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber } from "ethers";

describe("GenArt721Minter", async function () {
  const name = "Non Fungible Token";
  const symbol = "NFT";

  const firstTokenId = new BN("30000000");
  const secondTokenId = new BN("3000001");

  const pricePerTokenInWei = ethers.utils.parseEther("1");
  const projectZero = 3; // V1 core starts at project 3
  const projectOne = 4;

  beforeEach(async function () {
    const [owner, newOwner, artist, additional, snowfro] =
      await ethers.getSigners();
    this.accounts = {
      owner: owner,
      newOwner: newOwner,
      artist: artist,
      additional: additional,
      snowfro: snowfro,
    };
    const randomizerFactory = await ethers.getContractFactory(
      "BasicRandomizer"
    );
    this.randomizer = await randomizerFactory.deploy();
    const artblocksFactory = await ethers.getContractFactory("GenArt721CoreV1");
    this.token = await artblocksFactory
      .connect(snowfro)
      .deploy(name, symbol, this.randomizer.address);
    // deploy minter
    const minterFactory = await ethers.getContractFactory(
      "GenArt721LegacyMinter"
    );
    this.minter = await minterFactory.deploy(this.token.address);

    // add projects
    await this.token
      .connect(snowfro)
      .addProject("project1", artist.address, pricePerTokenInWei, false);
    await this.token
      .connect(snowfro)
      .addProject("project2", artist.address, pricePerTokenInWei, false);

    await this.token.connect(snowfro).toggleProjectIsActive(projectZero);
    await this.token.connect(snowfro).toggleProjectIsActive(projectOne);

    await this.token.connect(snowfro).addMintWhitelisted(this.minter.address);

    await this.token
      .connect(artist)
      .updateProjectMaxInvocations(projectZero, 15);
    await this.token
      .connect(artist)
      .updateProjectMaxInvocations(projectOne, 15);

    this.token.connect(this.accounts.artist).toggleProjectIsPaused(projectZero);
    this.token.connect(this.accounts.artist).toggleProjectIsPaused(projectOne);
  });

  describe("(LEGACY MINTER) purchase method", async function () {
    it("mints and calculates gas values", async function () {
      await this.minter.connect(this.accounts.owner).purchase(projectZero, {
        value: pricePerTokenInWei,
      });

      const tx = await this.minter
        .connect(this.accounts.owner)
        .purchase(projectOne, {
          value: pricePerTokenInWei,
        });

      const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
      const txCost = receipt.effectiveGasPrice.mul(receipt.gasUsed).toString();
      console.log(
        "Gas cost for a successful (LEGACY) Ether mint: ",
        ethers.utils.formatUnits(txCost, "ether").toString()
      );

      expect(txCost.toString()).to.equal(ethers.utils.parseEther("0.0356173")); // assuming a cost of 100 GWEI
    });

    it("does nothing if setProjectMaxInvocations is not called (fails correctly)", async function () {
      for (let i = 0; i < 15; i++) {
        await this.minter.connect(this.accounts.owner).purchase(projectZero, {
          value: pricePerTokenInWei,
        });
      }

      const ownerBalance = await this.accounts.owner.getBalance();
      await expectRevert(
        this.minter.connect(this.accounts.owner).purchase(projectZero, {
          value: pricePerTokenInWei,
        }),
        "Must not exceed max invocations"
      );
    });

    it("doesnt add too much gas if setProjectMaxInvocations is set", async function () {
      // Try without setProjectMaxInvocations, store gas cost
      const ownerBalanceNoMaxSet = await this.accounts.owner.getBalance();
      for (let i = 0; i < 15; i++) {
        await this.minter.connect(this.accounts.owner).purchase(projectZero, {
          value: pricePerTokenInWei,
          gasPrice: 1,
        });
      }
      // Add back in mint costs to get only gas costs
      const ownerDeltaNoMaxSet = (await this.accounts.owner.getBalance())
        .sub(ownerBalanceNoMaxSet)
        .add(pricePerTokenInWei.mul(15));

      // Try with setProjectMaxInvocations, store gas cost
      await this.minter
        .connect(this.accounts.snowfro)
        .setProjectMaxInvocations(projectOne);
      const ownerBalanceMaxSet = await this.accounts.owner.getBalance();
      for (let i = 0; i < 15; i++) {
        await this.minter.connect(this.accounts.owner).purchase(projectOne, {
          value: pricePerTokenInWei,
          gasPrice: 1,
        });
      }
      // Add back in mint costs to get only gas costs
      const ownerDeltaMaxSet = (await this.accounts.owner.getBalance())
        .sub(ownerBalanceMaxSet)
        .add(pricePerTokenInWei.mul(15));

      console.log(
        "Gas cost for 15 successful mints with setProjectMaxInvocations: ",
        ownerDeltaMaxSet.toString()
      );
      console.log(
        "Gas cost for 15 successful mints without setProjectMaxInvocations: ",
        ownerDeltaNoMaxSet.toString()
      );

      // Check that with setProjectMaxInvocations it's not too much moer expensive
      expect(
        ownerDeltaMaxSet.abs().lt(ownerDeltaNoMaxSet.abs().mul(110).div(100))
      ).to.be.true;
    });

    it("fails more cheaply if setProjectMaxInvocations is set", async function () {
      // Try without setProjectMaxInvocations, store gas cost
      for (let i = 0; i < 15; i++) {
        await this.minter.connect(this.accounts.owner).purchase(projectZero, {
          value: pricePerTokenInWei,
        });
      }
      const ownerBalanceNoMaxSet = await this.accounts.owner.getBalance();
      await expectRevert(
        this.minter.connect(this.accounts.owner).purchase(projectZero, {
          value: pricePerTokenInWei,
          gasPrice: 1,
        }),
        "Must not exceed max invocations"
      );
      const ownerDeltaNoMaxSet = (await this.accounts.owner.getBalance()).sub(
        ownerBalanceNoMaxSet
      );

      // Try with setProjectMaxInvocations, store gas cost
      await this.minter
        .connect(this.accounts.snowfro)
        .setProjectMaxInvocations(projectOne);
      for (let i = 0; i < 15; i++) {
        await this.minter.connect(this.accounts.owner).purchase(projectOne, {
          value: pricePerTokenInWei,
        });
      }
      const ownerBalanceMaxSet = await this.accounts.owner.getBalance();
      await expectRevert(
        this.minter.connect(this.accounts.owner).purchase(projectOne, {
          value: pricePerTokenInWei,
          gasPrice: 1,
        }),
        "Maximum number of invocations reached"
      );
      const ownerDeltaMaxSet = (await this.accounts.owner.getBalance()).sub(
        ownerBalanceMaxSet
      );

      console.log(
        "Gas cost with setProjectMaxInvocations: ",
        ownerDeltaMaxSet.toString()
      );
      console.log(
        "Gas cost without setProjectMaxInvocations: ",
        ownerDeltaNoMaxSet.toString()
      );

      expect(ownerDeltaMaxSet.abs().lt(ownerDeltaNoMaxSet.abs())).to.be.true;
    });
  });
});