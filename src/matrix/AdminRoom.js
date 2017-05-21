class AdminRoom {

    /**
     * Creates a new Matrix Admin Room
     * @param {string} roomId the Matrix room ID
     * @param {InstagramBridge} bridge the Instagram bridge
     */
    constructor(roomId, bridge) {
        this._roomId = roomId;
        this._bridge = bridge;
    }

    /**
     * Processes an event intended for this admin room
     * @param {MatrixEvent} event the event to process
     */
    handleEvent(event) {
        if(event.type === "m.room.membership") {
            // TODO: Determine if this room is still an admin room
        }
    }
}

module.exports = AdminRoom;