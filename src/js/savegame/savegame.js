/* typehints:start */
import { Application } from "../application";
import { GameRoot } from "../game/root";
/* typehints:end */

import { ReadWriteProxy } from "../core/read_write_proxy";
import { ExplainedResult } from "../core/explained_result";
import { SavegameSerializer } from "./savegame_serializer";
import { BaseSavegameInterface } from "./savegame_interface";
import { createLogger } from "../core/logging";
import { globalConfig } from "../core/config";
import { SavegameInterface_V1000 } from "./schemas/1000";
import { getSavegameInterface } from "./savegame_interface_registry";

const logger = createLogger("savegame");

export class Savegame extends ReadWriteProxy {
    /**
     *
     * @param {Application} app
     * @param {object} param0
     * @param {string} param0.internalId
     * @param {import("./savegame_manager").SavegameMetadata} param0.metaDataRef Handle to the meta data
     */
    constructor(app, { internalId, metaDataRef }) {
        super(app, "savegame-" + internalId + ".bin");
        this.internalId = internalId;
        this.metaDataRef = metaDataRef;

        /** @type {SavegameData} */
        this.currentData = this.getDefaultData();
    }

    //////// RW Proxy Impl //////////

    /**
     * @returns {number}
     */
    static getCurrentVersion() {
        return 1015;
    }

    /**
     * @returns {typeof BaseSavegameInterface}
     */
    static getReaderClass() {
        return SavegameInterface_V1000;
    }

    /**
     * @returns {number}
     */
    getCurrentVersion() {
        return /** @type {typeof Savegame} */ (this.constructor).getCurrentVersion();
    }

    /**
     * Returns the savegames default data
     * @returns {SavegameData}
     */
    getDefaultData() {
        return {
            version: this.getCurrentVersion(),
            dump: null,
            stats: {
                buildingsPlaced: 0,
            },
            lastUpdate: Date.now(),
        };
    }

    /**
     * Migrates the savegames data
     * @param {SavegameData} data
     */
    migrate(data) {
        // if (data.version === 1014) {
        //     if (data.dump) {
        //         const reader = new SavegameInterface_V1015(fakeLogger, data);
        //         reader.migrateFrom1014();
        //     }
        //     data.version = 1015;
        // }
        return ExplainedResult.good();
    }

    /**
     * Verifies the savegames data
     * @param {SavegameData} data
     */
    verify(data) {
        if (!data.dump) {
            // Well, guess that works
            return ExplainedResult.good();
        }

        if (!this.getDumpReaderForExternalData(data).validate()) {
            return ExplainedResult.bad("dump-reader-failed-validation");
        }
        return ExplainedResult.good();
    }

    //////// Subclasses interface  ////////

    /**
     * Returns if this game can be saved on disc
     * @returns {boolean}
     */
    isSaveable() {
        return true;
    }
    /**
     * Returns the statistics of the savegame
     * @returns {SavegameStats}
     */
    getStatistics() {
        return this.currentData.stats;
    }

    /**
     * Returns the *real* last update of the savegame, not the one of the metadata
     * which could also be the servers one
     */
    getRealLastUpdate() {
        return this.currentData.lastUpdate;
    }

    /**
     * Returns if this game has a serialized game dump
     */
    hasGameDump() {
        return !!this.currentData.dump;
    }

    /**
     * Returns the current game dump
     * @returns {SerializedGame}
     */
    getCurrentDump() {
        return this.currentData.dump;
    }

    /**
     * Returns a reader to access the data
     * @returns {BaseSavegameInterface}
     */
    getDumpReader() {
        if (!this.currentData.dump) {
            logger.warn("Getting reader on null-savegame dump");
        }

        const cls = /** @type {typeof Savegame} */ (this.constructor).getReaderClass();
        return new cls(this.currentData);
    }

    /**
     * Returns a reader to access external data
     * @returns {BaseSavegameInterface}
     */
    getDumpReaderForExternalData(data) {
        assert(data.version, "External data contains no version");
        return getSavegameInterface(data);
    }

    ///////// Public Interface ///////////

    /**
     * Updates the last update field so we can send the savegame to the server,
     * WITHOUT Saving!
     */
    setLastUpdate(time) {
        this.currentData.lastUpdate = time;
    }

    /**
     *
     * @param {GameRoot} root
     */
    updateData(root) {
        // Construct a new serializer
        const serializer = new SavegameSerializer();

        // let timer = performanceNow();
        const dump = serializer.generateDumpFromGameRoot(root);
        if (!dump) {
            return false;
        }
        // let duration = performanceNow() - timer;
        // console.log("TOOK", duration, "ms to generate dump:", dump);

        const shadowData = Object.assign({}, this.currentData);
        shadowData.dump = dump;
        shadowData.lastUpdate = new Date().getTime();
        shadowData.version = this.getCurrentVersion();

        const reader = this.getDumpReaderForExternalData(shadowData);

        // Validate (not in prod though)
        if (!G_IS_RELEASE) {
            const validationResult = reader.validate();
            if (!validationResult) {
                return false;
            }
        }

        // Save data
        this.currentData = shadowData;
    }

    /**
     * Writes the savegame as well as its metadata
     */
    writeSavegameAndMetadata() {
        return this.writeAsync().then(() => this.saveMetadata());
    }

    /**
     * Updates the savegames metadata
     */
    saveMetadata() {
        const reader = this.getDumpReader();
        this.metaDataRef.lastUpdate = new Date().getTime();
        this.metaDataRef.version = this.getCurrentVersion();
        return this.app.savegameMgr.writeAsync();
    }

    /**
     * @see ReadWriteProxy.writeAsync
     * @returns {Promise<any>}
     */
    writeAsync() {
        if (G_IS_DEV && globalConfig.debug.disableSavegameWrite) {
            return Promise.resolve();
        }
        return super.writeAsync();
    }
}