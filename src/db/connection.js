const mysql = require('mysql2/promise');

let conn = null;

const initMYSQL = async () => {
    while (true) {
        try {
            conn = await mysql.createConnection({
                host: process.env.DB_HOST || 'db',
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASSWORD || 'root',
                database: process.env.DB_NAME || 'webdb',
                port: process.env.DB_PORT || 3306,
            });

            console.log('MySQL connected');
            break;

        } catch (err) {
            // Node พยายามจะ speedrun แต่ MySQL init ยังไม่เสร็จ Node เลยแตก
            console.log('Waiting for MySQL... (This may take a while)');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
};

const getConn = () => conn;

module.exports = { initMYSQL, getConn };
