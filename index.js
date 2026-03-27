const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');  // Ensure you're using mysql2/promise
const cors = require('cors');
const app = express();

const port = 8000;
app.use(bodyParser.json());
app.use(cors());

let conn = null;

// Initialize MySQL connection
const initMYSQL = async () => {
    conn = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: 'root',
        database: 'webdb',
        port: 8700,
    });
};

const validateData = (userData) => {
    let errors = [];

    if (!userData.firstName) {
        errors.push('กรุณากรอกชื่อ');
    }
    if (!userData.lastName) {
        errors.push('กรุณากรอกนามสกุล');
    }
    if (!userData.age) {
        errors.push('กรุณากรอกอายุ');
    }
    if (!userData.gender) {
        errors.push('กรุณาเลือกเพศ');
    }
    if (!userData.interests) {
        errors.push('กรุณาเลือกความสนใจ');
    }
    if (!userData.description) {
        errors.push('กรุณากรอกคำอธิบาย');
    }
    return errors;
};

const submitData = async () => {
    let firstNameDOM = document.querySelector('input[name=firstname]');
    let lastNameDOM = document.querySelector('input[name=lastname]');
    let ageDOM = document.querySelector('input[name=age]');
    let genderDOM = document.querySelector('input[name=gender]:checked') || {};
    let interestDOMs = document.querySelectorAll('input[name=interest]:checked') || [];
    let descriptionDOM = document.querySelector('textarea[name=description]');
    let messageDOM = document.getElementById('message');

    try {
        let interest = Array.from(interestDOMs).map(i => i.value).join(',');

        let userData = {
            firstName: firstNameDOM.value,  
            lastName: lastNameDOM.value,
            age: ageDOM.value,
            gender: genderDOM.value,
            interests: interest,
            description: descriptionDOM.value
        };

        console.log("submitData", userData);

        const errors = validateData(userData);
        if (errors.length > 0) {
            throw {
                message: 'กรุณากรอกข้อมูลให้ครบถ้วน',
                errors: errors
            };
        }

        const response = await axios.post('http://localhost:8000/users', userData);
        console.log('response', response.data);
        messageDOM.innerText = 'บันทึกข้อมูลเรียบร้อย';
        messageDOM.className = 'message success';
    } catch (error) {
        let htmlData = '<div>';
        htmlData += `<div> ${error.message} </div>`;
        htmlData += '<ul>';

        if (error.errors) {
            for (let i = 0; i < error.errors.length; i++) {
                htmlData += `<li> ${error.errors[i]} </li>`;
            }
        }

        htmlData += '</ul>';
        htmlData += '</div>';
        
        messageDOM.innerText = 'เกิดข้อผิดพลาดในการบันทึกข้อมูล';
        messageDOM.className = 'message danger';
    }
};

// Test DB connection
app.get('/testdb', async (req, res) => {
    try {
        const [results] = await conn.query('SELECT * FROM users');
        res.json(results);
    } catch (error) {
        console.log('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Test DB with a specific query (example)
app.get('/testdbnew', async (req, res) => {
    try {
        const [results] = await conn.query('SELECT idx FROM users');
        res.json(results);
    } catch (error) {
        console.log('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /users - Fetch all users
app.get('/users', async (req, res) => {
    try {
        const [results] = await conn.query('SELECT * FROM users');
        res.json(results);
    } catch (error) {
        console.log('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// POST /users - Create a new user
app.post('/users', async (req, res) => {
    try {
        let user = req.body;
        const results = await conn.query('INSERT INTO users SET ?', user);
        
        res.json({
            message: 'Create user successfully',
            data: results[0]
        });
    } catch (error) {
        if(error.length > 0){
            throw {
                message: 'กรุณากรอกข้อมูลให้ครบถ้วน',
                errors: errors
            };
        }
        const errorMessage = error.message || 'something went wrong';
        const errors = error.errors || [];
        console.error("error",error.Message)
        res.status(500).json({
            message: 'errorMessage',
            errors: errors
        })
        
    }
});

// GET /user/:id - Fetch user by ID
app.get('/users/:id', async (req, res) => {
    try {
        let id = req.params.id;
        let updateUser = req.body;
        const results = await conn.query('SELECT * FROM users WHERE id = ?', id);
        if (results[0].length == 0) {

            throw {statusCode: 404, message: 'User not found'};
        }
        res.json(results[0][0]);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ 
            message: "something went wrong",
            errorMessage: error.message});
    }
});

// PUT /user/:id - Update user by ID
app.put('/users/:id', async (req, res) => {
        let id = req.params.id;
        let updateUser = req.body;
        try {
            let user = req.body
            const results = await conn.query('UPDATE users SET ? WHERE id = ?', [updateUser, id]);
            res.json({
                message: 'Update user successfully',
                data: results[0]
            });
        } catch (error) {
            console.error('Error:', error.message);
            res.status(500).json({ 
                message: "something went wrong",
                errorMessage: error.message});
        }
    });

// DELETE /user/:id - Delete user by ID
app.delete('/users/:id', async (req, res) => {
    
    try {
        let id = req.params.id;
        const results = await conn.query('DELETE FROM users WHERE id = ?', id);
            res.json({
                message: 'Delete user successfully',
                data: results[0]
            });
    } catch (error) {
        console.log('Error:', error.message);
        res.status(500).json({ 
            message: "something went wrong",
            errorMessage: error.message });
    }
});

app.listen(port, async () => {
    await initMYSQL();
    console.log('Http Server is running on port ' + port);
});