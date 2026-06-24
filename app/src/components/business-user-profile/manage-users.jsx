/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { useState } from "react";
import PropTypes from "prop-types";
import AddUser from "./add-user";
import { Button, Dialog, DialogActions, DialogContent } from "@mui/material";
import ListUsers from "./list-users";

const ManageUsers = ({ organizationId }) => {

  const [openForm, setOpenForm] = useState(false);
  const [openView, setOpenView] = useState(false);

  const handleCancelEdit = () => {
    setOpenForm(false);
  };

  return (
    <>
      <div className="box-zone">
        <h5>Manage Users</h5>
        <p>
          Add, edit or delete users in your business account.
        </p>
        <div>
          <button
            onClick={() => setOpenForm(true)}
            className=""
          >
            Add User
          </button>
        </div>
        <div>
          <button
          onClick={() => setOpenView(true)}
            className="secondary"
          >
            View Users
          </button>
        </div>
      </div>
      <Dialog open={openView} onClose={() => setOpenView(false)} maxWidth="xl" fullWidth>
          <DialogContent>
            <ListUsers organizationId={organizationId} />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenView(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      <Dialog open={openForm} onClose={() => setOpenForm(false)} maxWidth="sm" fullWidth>
          <DialogContent className="about_section">
            <AddUser organizationId={organizationId} onCancel={handleCancelEdit}/>
          </DialogContent>
        </Dialog>
    </>
  );
};

ManageUsers.propTypes = {
  organizationId: PropTypes.string.isRequired,
};

export default ManageUsers;
