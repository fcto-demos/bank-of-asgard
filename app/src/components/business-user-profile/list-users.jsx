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

import * as React from 'react';
import { DataGrid } from '@mui/x-data-grid';
import Paper from '@mui/material/Paper';
import { useEffect } from 'react';
import { environmentConfig } from '../../util/environment-util';
import { useUser } from '@asgardeo/react';
import { useHttpSwitch } from '../../sdk/httpSwitch';
import { Box, CircularProgress, IconButton, MenuItem, Select, TextField } from '@mui/material';
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import CountrySelect from '../../components/country-select';
import { enqueueSnackbar } from 'notistack';

const ListUsers = () => {

  const { profile } = useUser();
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [editingUser, setEditingUser] = React.useState(null);
  const paginationModel = { page: 0, pageSize: 5 };
  const [deletingUserId, setDeletingUserId] = React.useState(null);
  const [assigningRoleUserId, setAssigningRoleUserId] = React.useState(null);

  const columns = [
    { field: 'id', headerName: 'ID', width: 280, sortable: false },
    { field: 'username', headerName: 'Username', width: 220 },
    { field: 'givenName', headerName: 'First Name', width: 160 },
    { field: 'familyName', headerName: 'Last Name', width: 160 },
    { field: 'email', headerName: 'Email', width: 220 },
    {
      field: "assignRole",
      headerName: "Assign Role",
      width: 140,
      sortable: false,
      renderCell: (params) => (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            height: "100%",
            gap: 1,
          }}
        >
          <Select
            value={params.row.role || ""}
            onChange={(e) => handleRoleSelect(e.target.value, params.row)}
            disabled={assigningRoleUserId === params.row.id}
            variant="standard"
            sx={{
              "& .MuiSelect-select": {
                paddingY: 0,
                display: "flex",
                alignItems: "center",
                fontSize: "0.875rem",
                height: "100%",
              },
              fontSize: "0.875rem",
              background: "transparent",
            }}
            MenuProps={{
              PaperProps: {
                sx: {
                  "& .MuiMenuItem-root": {
                    fontSize: "0.875rem",
                    minHeight: "32px",
                  },
                },
              },
            }}
          >
            <MenuItem value="Member">Member</MenuItem>
            <MenuItem value="Manager">Manager</MenuItem>
            <MenuItem value="Auditor">Auditor</MenuItem>
          </Select>

          {assigningRoleUserId === params.row.id && (
            <CircularProgress size={20} />
          )}
        </Box>
      ),
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 100,
      sortable: false,
      renderCell: (params) => (
        <>
        <IconButton
          aria-label="edit"
          color="primary"
          onClick={() => setEditingUser(params.row)}
        >
          <EditIcon />
        </IconButton>
        <IconButton
          aria-label="delete"
          color="error"
          onClick={() => handleDelete(params.row.id)}
          disabled={deletingUserId === params.row.id}
        >
          {deletingUserId === params.row.id ? (
            <CircularProgress size={20} />
          ) : (
            <DeleteIcon />
          )}
        </IconButton>
        </>
      ),
    },
  ];

  function cleanUsername(rawUsername = "") {
    return rawUsername.includes("/") ? rawUsername.split("/")[1] : rawUsername;
  }

  function transformUsers(data) {
    if (!data.Resources) return [];

    return data.Resources
      .filter((user) => cleanUsername(user.userName) !== profile.userName)
      .map((user) => ({
        id: user.id,
        username: cleanUsername(user.userName),
        givenName: user.name?.givenName ?? "",
        familyName: user.name?.familyName ?? "",
        email: user.emails?.[0] ?? "",
        role: user.roles?.[0]?.display ?? "",
        dateOfBirth: user["urn:scim:wso2:schema"].dateOfBirth ?? "",
        country: user["urn:scim:wso2:schema"].country ?? "",
        mobile: user.phoneNumbers?.[0]?.value ?? ""
      }));
  }

  const httpSwitch = useHttpSwitch();

  useEffect(() => {
    const requestConfig = {
      headers: {
        Accept: "application/scim+json",
        "Content-Type": "application/scim+json",
      },
      method: "GET",
      url: `${environmentConfig.IDP_BASE_URL}/o/scim2/Users`,
    };

    httpSwitch
      .request(requestConfig)
      .then((response) => {
        setRows(transformUsers(response.data));
      })
      .catch((error) => {
        console.error("Error fetching SCIM users:", error);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (userId) => {

    try {
      setDeletingUserId(userId);
      const requestConfig = {
        method: "DELETE",
        url: `${environmentConfig.IDP_BASE_URL}/o/scim2/Users/${userId}`,
        headers: {
          Accept: "*/*",
          "Content-Type": "application/scim+json",
        },
      };
      const response = await httpSwitch.request(requestConfig);
      if (response.status === 204) {
        enqueueSnackbar("User deleted successfully", { variant: "success" });
        setRows((prevRows) => prevRows.filter((row) => row.id !== userId));
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      enqueueSnackbar("Failed to delete user", { variant: "error" });
    } finally {
      setDeletingUserId(null);
    }
  };

  const handleSave = async (updatedUser) => {

    const patchValue = {
      name: {
        givenName: updatedUser.givenName,
        familyName: updatedUser.familyName,
      },
      emails: [updatedUser.email],
      "urn:scim:wso2:schema": {
        dateOfBirth: updatedUser.dateOfBirth,
        country: updatedUser.country,
      },
      phoneNumbers: [{ type: "mobile", value: updatedUser.mobile }],
    };
    if (updatedUser.password && updatedUser.password.trim() !== "") {
      patchValue.password = updatedUser.password;
    }

    const requestConfig = {
      method: "PATCH",
      url: `${environmentConfig.IDP_BASE_URL}/o/scim2/Users/${updatedUser.id}`,
      headers: {
        Accept: "application/scim+json",
        "Content-Type": "application/scim+json",
      },
      data: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [
          {
            op: "replace",
            value: patchValue,
          },
        ],
      },
    };

    try {
    const response = await httpSwitch.request(requestConfig);
      setRows((prevRows) =>
        prevRows.map((row) =>
          row.id === updatedUser.id ? updatedUser : row
        )
      );
      if (response.status === 200) {
        enqueueSnackbar("User updated successfully", { variant: "success" });
      }
      setEditingUser(null);
      } catch (error) {
        console.error("Error updating user:", error);
        enqueueSnackbar("Error updating user", { variant: "error" });
      }
  };

  const handleRoleSelect = async (newRoleName, selectedUser) => {

    setAssigningRoleUserId(selectedUser.id);
    setRows((prev) =>
      prev.map((row) =>
        row.id === selectedUser.id ? { ...row, role: newRoleName } : row
      )
    );
  try {
    const currentRoleId = await getRoleIdByName(selectedUser.role);
    const newRoleId = await getRoleIdByName(newRoleName);

    if (!newRoleId) {
      console.error(`Role ID not found for role: ${newRoleName}`);
      return;
    }

    if (currentRoleId) {
      await httpSwitch.request({
        method: "PATCH",
        url: `${environmentConfig.IDP_BASE_URL}/o/scim2/v2/Roles/${currentRoleId}`,
        headers: {
          Accept: "application/scim+json",
          "Content-Type": "application/scim+json",
        },
        data: {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
          Operations: [
            {
              op: "remove",
              path: `users[value eq "${selectedUser.id}"]`
            }
          ]
        }
      });
    }

    await httpSwitch.request({
      method: "PATCH",
      url: `${environmentConfig.IDP_BASE_URL}/o/scim2/v2/Roles/${newRoleId}`,
      headers: {
        Accept: "application/scim+json",
        "Content-Type": "application/scim+json",
      },
      data: {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [
          {
            op: "add",
            path: "users",
            value: [{ value: selectedUser.id }]
          }
        ]
      }
    });

  } catch (error) {
    console.error("Error switching role:", error);
  } finally {
    setAssigningRoleUserId(null);
  }
};

  const getRoleIdByName = async (roleName) => {
    const requestConfig = {
      method: "GET",
      url: `${environmentConfig.IDP_BASE_URL}/o/scim2/v2/Roles?filter=displayName eq ${encodeURIComponent(roleName)}`,
      headers: {
        Accept: "application/scim+json",
      },
    };

    try {
      const response = await httpSwitch.request(requestConfig);
      const resources = response.data?.Resources || [];
      return resources.length > 0 ? resources[0].id : null;
    } catch (error) {
      console.error("Error fetching role ID:", error);
      return null;
    }
  };

  if (editingUser) {
    return (
      <Paper sx={{ p: 3 }}>
        <Box component="form" sx={{ display: "grid", gap: 2, maxWidth: 400 }}>
          <TextField
            label="Username"
            value={editingUser.username}
            slotProps={{
              input: { readOnly: true },
            }}
            sx={{
              "& .MuiInputBase-input[readonly]": {
                backgroundColor: (theme) => theme.palette.action.disabledBackground
              },
            }}
          />
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              label="First Name"
              value={editingUser.givenName}
              onChange={(e) =>
                setEditingUser({ ...editingUser, givenName: e.target.value })
              }
            />
            <TextField
              label="Last Name"
              value={editingUser.familyName}
              onChange={(e) =>
                setEditingUser({ ...editingUser, familyName: e.target.value })
              }
            />
          </Box>
          <TextField
            label="Date of Birth"
            type="date"
            value={editingUser.dateOfBirth || ""}
            onChange={(e) =>
              setEditingUser({ ...editingUser, dateOfBirth: e.target.value })
            }
          />

          <TextField
            label="Email"
            value={editingUser.email}
            onChange={(e) =>
              setEditingUser({ ...editingUser, email: e.target.value })
            }
          />
          <CountrySelect
            label = "Country"
            value={editingUser.country}
            onChange={(e) =>
              setEditingUser({ ...editingUser, country: e.label })
            }
          />
          <TextField
            label="Mobile Number"
            type="tel"
            value={editingUser.mobile}
            onChange={(e) =>
              setEditingUser({ ...editingUser, mobile: e.target.value })
            }
          />
          <TextField
            label="Password"
            type="password"
            value={editingUser.password || ""}
            onChange={(e) =>
              setEditingUser({ ...editingUser, password: e.target.value })
            }
          />
          <Box sx={{ display: "flex", gap: 2, mt: 2 }}>
            <button
              className="gold-button"
              onClick={(e) => {
                e.preventDefault();
                handleSave(editingUser)
              }}
            >
              Save
            </button>
            <button
            onClick={() => setEditingUser(null)} className="black-button">
              Back
            </button>
          </Box>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper sx={{ height: 400, width: '100%' }}>
      <DataGrid
        rows={rows}
        columns={columns}
        loading={loading}
        initialState={{ pagination: { paginationModel } }}
        pageSizeOptions={[5, 10]}
        sx={{ border: 0 }}
        className="user-data"
        disableColumnMenu
      />
    </Paper>
  );
}

export default ListUsers;
